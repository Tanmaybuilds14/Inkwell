import { auth } from '@clerk/nextjs/server';
import { prisma } from '@/lib/prisma';

/**
 * Returns the local User row for the current Clerk session, creating it on
 * first sight. Returns null when signed out.
 */
export async function getCurrentUser() {
  const { userId } = await auth();
  if (!userId) return null;
  return ensureUser(userId);
}

export async function ensureUser(clerkId) {
  // Best-effort profile fetch; a fresh sign-up may not have an email yet.
  let email = `${clerkId}@inkwell.local`;
  let name = null;
  try {
    const { clerkClient } = await import('@clerk/nextjs/server');
    const client = await clerkClient();
    const user = await client.users.getUser(clerkId);
    email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? email;
    name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || null;
  } catch {
    // Fail open on profile enrichment only — identity is still clerkId.
  }

  // Claim any pre-provisioned row created when this address was invited,
  // so permissions granted by email carry over on first sign-in. The real
  // email replaces the placeholder here too — otherwise every subsequent
  // call re-runs the Clerk lookup just to keep the placeholder in sync.
  const claimed = await prisma.user.findFirst({ where: { email } });
  if (claimed && claimed.clerkId.startsWith('pending_')) {
    return prisma.user.update({
      where: { id: claimed.id },
      data: { clerkId, email, ...(name && claimed.name == null ? { name } : {}) },
    });
  }

  // Sync the Clerk-derived name only while the local row has none — once the
  // user sets a display name in their profile, it must not be clobbered by
  // the next ensureUser() call. Email still stays in sync with Clerk.
  const existing = await prisma.user.findUnique({ where: { clerkId } });

  // Use upsert directly to avoid TOCTOU race between findUnique and create.
  return prisma.user.upsert({
    where: { clerkId },
    update: { email, ...(existing?.name == null && name ? { name } : {}) },
    create: { clerkId, email, name },
  });
}
