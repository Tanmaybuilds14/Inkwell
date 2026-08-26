import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { handle, apiError, json } from '@/lib/api-helpers';

async function requireOwnFolder(folderId, userId) {
  const folder = await prisma.folder.findFirst({
    where: { id: folderId, ownerId: userId },
    select: { id: true, name: true, parentId: true },
  });
  if (!folder) throw apiError(404, 'Folder not found');
  return folder;
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');
    const { id } = await params;
    await requireOwnFolder(id, user.id);

    const body = await request.json().catch(() => ({}));
    const data = {};
    if (typeof body.name === 'string' && body.name.trim()) {
      data.name = body.name.trim().slice(0, 120);
    }
    if ('parentId' in body) {
      if (body.parentId === id) return apiError(400, 'A folder cannot contain itself');
      if (body.parentId === null) {
        data.parentId = null;
      } else {
        const parent = await prisma.folder.findFirst({
          where: { id: body.parentId, ownerId: user.id },
          select: { id: true },
        });
        if (!parent) return apiError(404, 'Parent folder not found');
        data.parentId = parent.id;
      }
    }
    if (Object.keys(data).length === 0) return apiError(400, 'Nothing to update');

    const folder = await prisma.folder.update({
      where: { id },
      data,
      select: { id: true, name: true, parentId: true },
    });
    return json({ folder });
  });
}

export async function DELETE(request, { params }) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');
    const { id } = await params;
    await requireOwnFolder(id, user.id);

    // Nested folders/documents fall back to root via onDelete: SetNull.
    await prisma.folder.delete({ where: { id } });
    return json({ ok: true });
  });
}
