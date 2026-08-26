import { prisma } from '@/lib/prisma';
import { handle, json, requireDocument } from '@/lib/api-helpers';

/** GET — list version snapshots, newest first. Viewer+ (read-only info). */
export async function GET(request, { params }) {
  return handle(async () => {
    const { id } = await params;
    await requireDocument(request, id, 'VIEWER');

    const versions = await prisma.versionSnapshot.findMany({
      where: { documentId: id },
      select: {
        id: true,
        title: true,
        createdAt: true,
        creator: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return json({
      versions: versions.map((v) => ({
        id: v.id,
        title: v.title,
        createdAt: v.createdAt,
        createdBy: v.creator?.name ?? v.creator?.email ?? null,
      })),
    });
  });
}
