import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { ensureSchema } from '@/lib/migrations';
import { handle, apiError, json } from '@/lib/api-helpers';
import { logActivity, ACTIVITY_TYPES } from '@/lib/activity';

// 200 KB decoded ceiling for the profile photo. Uploaded images are
// client-side downscaled before upload; this is the hard server-side cap.
const MAX_IMAGE_BYTES = 200 * 1024;
const MAX_NAME_LENGTH = 80;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const IMAGE_PREFIX = 'data:image/';

export async function GET() {
  return handle(async () => {
    await ensureSchema();
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');
    return json({ user });
  });
}

export async function PATCH(request) {
  return handle(async () => {
    await ensureSchema();
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');

    const body = await request.json().catch(() => ({}));
    const data = {};

    if ('name' in body) {
      const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
      if (name.length > MAX_NAME_LENGTH) {
        return apiError(400, `Name must be ${MAX_NAME_LENGTH} characters or fewer`);
      }
      data.name = name || null;
    }

    if ('imageUrl' in body) {
      if (body.imageUrl === null || body.imageUrl === '') {
        data.imageUrl = null; // explicit removal
      } else if (typeof body.imageUrl === 'string' && body.imageUrl.startsWith(IMAGE_PREFIX)) {
        const header = body.imageUrl.slice(0, body.imageUrl.indexOf(','));
        const payload = body.imageUrl.slice(body.imageUrl.indexOf(',') + 1);
        if (!payload) return apiError(400, 'Invalid image data');
        const mime = header.slice(IMAGE_PREFIX.length, -7); // strip trailing ";base64"
        if (!ALLOWED_MIME.has(mime)) {
          return apiError(415, 'Unsupported image type');
        }
        const size = Math.floor((payload.length * 3) / 4);
        if (size > MAX_IMAGE_BYTES) {
          return apiError(413, 'Image is too large (200 KB max after downscale)');
        }
        data.imageUrl = body.imageUrl;
      } else {
        return apiError(400, 'imageUrl must be a data: URL or null');
      }
    }

    if (Object.keys(data).length === 0) return apiError(400, 'Nothing to update');

    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
      select: { id: true, name: true, imageUrl: true, onboardedAt: true, updatedAt: true },
    });

    if ('name' in data || 'imageUrl' in data) {
      logActivity(ACTIVITY_TYPES.PROFILE_UPDATED, {
        userId: user.id,
        meta: {
          fields: ['name' in data && 'name', 'imageUrl' in data && 'imageUrl'].filter(Boolean),
        },
      });
    }

    return json({ user: updated });
  });
}
