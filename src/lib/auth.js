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
  const existing = await prisma.user.findUnique({ where: { clerkId } });
  if (existing) return existing;

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
  // so permissions granted by email carry over on first sign-in.
  const claimed = await prisma.user.findFirst({ where: { email } });
  if (claimed && claimed.clerkId.startsWith('pending_')) {
    return prisma.user.update({
      where: { id: claimed.id },
      data: { clerkId, name },
    });
  }

  return prisma.user.upsert({
    where: { clerkId },
    update: {},
    create: { clerkId, email, name },
  });
}
