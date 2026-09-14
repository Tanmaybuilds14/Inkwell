import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { ensureSchema } from '@/lib/migrations';
import { handle, apiError, json } from '@/lib/api-helpers';

/**
 * GET /api/onboarding — whether the first-sign-in prompt should be shown.
 * POST /api/onboarding — mark onboarding complete (accepting defaults).
 */
export async function GET() {
  return handle(async () => {
    await ensureSchema();
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');
    return json({ onboarded: user.onboardedAt != null, name: user.name, imageUrl: user.imageUrl });
  });
}

export async function POST(request) {
  return handle(async () => {
    await ensureSchema();
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');

    const body = await request.json().catch(() => ({}));
    const data = { onboardedAt: new Date() };

    // Let the dialog save the chosen display name / photo in the same call
    // so completing onboarding never needs a second request.
    if ('name' in body) {
      const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ').slice(0, 80) : '';
      if (name) data.name = name;
    }
    if (typeof body.imageUrl === 'string' && body.imageUrl.startsWith('data:image/')) {
      data.imageUrl = body.imageUrl;
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
      select: { id: true, onboardedAt: true, name: true, imageUrl: true },
    });
    return json({ user: updated });
  });
}
