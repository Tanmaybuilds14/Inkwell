import { prisma } from '@/lib/prisma';
import { handle, apiError, json, requireDocument } from '@/lib/api-helpers';
import { recordMentions, MAX_MENTIONS_PER_REQUEST } from '@/lib/inbox';

/**
 * @mentions for one document.
 *
 *   GET  — who can be mentioned (the editor's "@" menu roster)
 *   POST — notify the people just mentioned
 *
 * Both require sign-in even though reading a document does not: a mention is a
 * notification, and only an account has an inbox to receive one. An anonymous
 * link-holder can still read (and, on an edit link, write) — they just cannot
 * take part in the mention loop, because nobody knows who they are.
 *
 * Emails never leave this route: the roster is display names for a picker, and
 * a collaborator's address is not something an editor needs to name them.
 */

/**
 * Name for the @-menu and for the label stored in the document.
 *
 * The fallback is the email's local part rather than the address itself: the
 * label is written into the document body permanently, so "alice" is the right
 * thing to render for the rest of that document's life, not "alice@corp.com"
 * for a colleague who simply never set a display name.
 */
function mentionLabel(user) {
  const name = user?.name?.trim();
  if (name) return name;
  const email = user?.email?.trim();
  if (!email) return 'Someone';
  return email.split('@')[0];
}
export async function GET(request, { params }) {
  return handle(async () => {
    const { id } = await params;
    const { user } = await requireDocument(request, id, 'VIEWER');
    if (!user) return apiError(401, 'Sign in to mention collaborators');

    const doc = await prisma.document.findUnique({
      where: { id },
      select: {
        owner: { select: { id: true, name: true, email: true, imageUrl: true } },
        permissions: {
          select: {
            user: { select: { id: true, name: true, email: true, imageUrl: true } },
          },
        },
      },
    });
    if (!doc) return apiError(404, 'Document not found');

    const seen = new Set();
    const people = [];
    // Owner first, then collaborators: the roster's order is the menu's
    // tie-break order (see filterMentionItems), so the most likely person to
    // mention is already on top before a single character is typed.
    for (const candidate of [doc.owner, ...doc.permissions.map((p) => p.user)]) {
      if (!candidate || seen.has(candidate.id) || candidate.id === user.id) continue;
      seen.add(candidate.id);
      people.push({
        id: candidate.id,
        name: mentionLabel(candidate),
        imageUrl: candidate.imageUrl ?? null,
      });
    }

    return json({ people });
  });
}

export async function POST(request, { params }) {
  return handle(async () => {
    const { id } = await params;
    // EDITOR, not COMMENTER: a mention is typed into the document body, so the
    // authority to make one is the authority to edit.
    const { user, document } = await requireDocument(request, id, 'EDITOR');
    if (!user) return apiError(401, 'Sign in to mention collaborators');

    const body = await request.json().catch(() => ({}));
    const userIds = Array.isArray(body.userIds)
      ? body.userIds.filter((value) => typeof value === 'string' && value)
      : [];
    if (userIds.length === 0) return apiError(400, 'userIds is required');
    if (userIds.length > MAX_MENTIONS_PER_REQUEST) {
      return apiError(400, `At most ${MAX_MENTIONS_PER_REQUEST} mentions per request`);
    }

    const notified = await recordMentions({
      userIds,
      documentId: id,
      docTitle: document.title,
      actorId: user.id,
      actorName: user.name ?? user.email,
    });

    return json({ notified });
  });
}
