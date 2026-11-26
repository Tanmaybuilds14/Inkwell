import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { handle, apiError, json } from '@/lib/api-helpers';

export async function GET() {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');

    const folders = await prisma.folder.findMany({
      where: { ownerId: user.id },
      select: {
        id: true,
        name: true,
        parentId: true,
        createdAt: true,
        _count: { select: { documents: { where: { deletedAt: null } } } },
      },
      orderBy: { name: 'asc' },
    });
    return json({ folders });
  });
}

export async function POST(request) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return apiError(401, 'Sign in required');

    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
    if (!name) return apiError(400, 'Folder name is required');

    let parentId = null;
    if (typeof body.parentId === 'string') {
      const parent = await prisma.folder.findFirst({
        where: { id: body.parentId, ownerId: user.id },
        select: { id: true },
      });
      if (!parent) return apiError(404, 'Parent folder not found');
      parentId = parent.id;
    }

    const folder = await prisma.folder.create({
      data: { name, ownerId: user.id, parentId },
      select: { id: true, name: true, parentId: true },
    });
    return json({ folder }, { status: 201 });
  });
}
