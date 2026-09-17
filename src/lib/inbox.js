import { prisma } from '@/lib/prisma';
import { track, EVENTS } from '@/lib/telemetry';

/**
 * User inbox: persistent, per-user receipts of collaboration activity.
 *
 *   - `invite`         — a named collaborator was granted access by email
 *   - `link_shared`    — a share link became active (or its role changed)
 *                        on a document the recipient already has access to
 *   - `link_opened`    — the recipient opened a shared document by link;
 *                        claimed once, so their dashboard reflects the doc
 *
 * Items are denormalized (title snapshot) so the inbox survives document
 * deletion and never needs a join to render. Writes are best-effort: a
 * failed inbox write must never break the sharing operation itself.
 *
 * Accepting: an invite/link_opened item starts unaccepted; the recipient
 * explicitly accepts from the inbox, which marks meta.acceptedAt and (for
 * items without one yet) saves a Permission row so the document shows in
 * their dashboard under "Shared with me".
 */

export const INBOX_TYPES = {
  INVITE: 'invite',
  LINK_SHARED: 'link_shared',
  LINK_OPENED: 'link_opened',
};

/** meta.acceptedAt is set by acceptInboxItem once the user accepts. */
export function isInviteAccepted(item) {
  return !!item?.meta?.acceptedAt;
}

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

/**
 * Record (or update) an invite inbox item for the invitee.
 * One row per (user, document): re-invites with a new role update the
 * existing item (new unread badge) instead of piling up duplicates.
 */
export async function recordInvite({
  userId,
  documentId,
  docTitle,
  inviterId,
  inviterName = null,
  role,
}) {
  if (!userId) return;
  try {
    const existing = await prisma.inboxItem.findFirst({
      where: { userId, documentId, type: INBOX_TYPES.INVITE },
      select: { id: true },
    });

    const meta = { role, ...(inviterName ? { inviterName } : {}) };

    if (existing) {
      await prisma.inboxItem.update({
        where: { id: existing.id },
        data: { docTitle, inviterId, meta, readAt: null, claimedAt: null, createdAt: new Date() },
      });
    } else {
      await prisma.inboxItem.create({
        data: {
          userId,
          type: INBOX_TYPES.INVITE,
          documentId,
          docTitle,
          inviterId,
          meta,
        },
      });
    }
    track(EVENTS.DOC_SHARED, { user_id: userId, document_id: documentId, inbox: true, role });
  } catch (err) {
    console.warn('[inbox] invite write failed:', err.message);
  }
}

/**
 * Record a `link_shared` receipt for every user who already has a
 * permission row on the document (excluding the owner/actor). Fired when
 * link sharing is enabled — collaborators see the doc appear in their
 * inbox even though the link itself is not saved for them.
 */
export async function recordLinkShared({ documentId, docTitle, actorId }) {
  try {
    const collaborators = await prisma.permission.findMany({
      where: { documentId, userId: { not: actorId } },
      select: { userId: true },
    });
    if (collaborators.length === 0) return;

    await prisma.inboxItem.createMany({
      data: collaborators.map((c) => ({
        userId: c.userId,
        type: INBOX_TYPES.LINK_SHARED,
        documentId,
        docTitle,
        inviterId: actorId,
        meta: { viaLink: true },
      })),
    });
  } catch (err) {
    console.warn('[inbox] link_shared write failed:', err.message);
  }
}

/**
 * Claim a shared link on the recipient's side.
 *
 * A link share is deliberately NOT persisted as a permission row when the
 * visitor is anonymous (the link IS the credential). But once a signed-in
 * user opens the link we save it on their side: a Permission row (so the
 * document shows in their dashboard) plus an inbox receipt so it stays
 * discoverable after the ?share= token leaves the URL.
 *
 * `role` is the document's shareRole (what the link grants).
 */
export async function claimSharedLink({ userId, documentId, docTitle, ownerId, role = 'EDITOR' }) {
  if (!userId || userId === ownerId) return;
  try {
    // Save the document on the receiver's side — dashboard "Shared with me"
    // is backed by Permission rows. Idempotent via the (documentId, userId)
    // unique constraint; keep the highest role already granted.
    const existingPermission = await prisma.permission.findFirst({
      where: { documentId, userId },
      select: { id: true, role: true },
    });
    if (!existingPermission) {
      // The document may have been deleted between the share and the open;
      // verify it still exists before creating the row (FK would throw).
      const doc = await prisma.document.findFirst({
        where: { id: documentId, deletedAt: null, ownerId: { not: userId } },
        select: { id: true },
      });
      if (doc) {
        await prisma.permission.create({
          data: {
            documentId,
            userId,
            role: ['EDITOR', 'COMMENTER', 'VIEWER'].includes(role) ? role : 'EDITOR',
            invitedBy: ownerId,
          },
        });
      }
    }

    const existing = await prisma.inboxItem.findFirst({
      where: { userId, documentId, type: INBOX_TYPES.LINK_OPENED },
      select: { id: true, claimedAt: true },
    });

    if (existing) {
      if (!existing.claimedAt) {
        await prisma.inboxItem.update({
          where: { id: existing.id },
          data: { claimedAt: new Date(), docTitle },
        });
      }
      return;
    }

    await prisma.inboxItem.create({
      data: {
        userId,
        type: INBOX_TYPES.LINK_OPENED,
        documentId,
        docTitle,
        inviterId: ownerId,
        meta: { viaLink: true, role },
        claimedAt: new Date(),
      },
    });
    track(EVENTS.DOC_OPENED, { user_id: userId, document_id: documentId, via_link: true });
  } catch (err) {
    console.warn('[inbox] link claim failed:', err.message);
  }
}

/**
 * Accept an inbox item (invite / link_opened): mark it accepted and make
 * sure the document is saved on the receiver's side — a Permission row so
 * it shows in their dashboard under "Shared with me".
 *
 * Returns the updated item, or null when the item doesn't exist, isn't the
 * caller's, or isn't an acceptable type. Idempotent: re-accepting is fine.
 */
export async function acceptInboxItem(userId, itemId) {
  try {
    const item = await prisma.inboxItem.findFirst({
      where: { id: itemId, userId },
      select: { id: true, type: true, documentId: true, docTitle: true, meta: true, inviterId: true },
    });
    if (
      !item ||
      !(item.type === INBOX_TYPES.INVITE || item.type === INBOX_TYPES.LINK_OPENED) ||
      !item.documentId
    ) {
      return null;
    }

    const meta = { ...(item.meta ?? {}), acceptedAt: new Date().toISOString() };
    await prisma.inboxItem.update({
      where: { id: item.id },
      data: { meta, readAt: new Date() },
    });

    // The receipt alone doesn't put the document in the receiver's
    // dashboard — only a Permission row does (documents "Shared with me"
    // are backed by permissions). Skip rows the user already has.
    const existingPermission = await prisma.permission.findFirst({
      where: { documentId: item.documentId, userId },
      select: { id: true, role: true },
    });
    if (!existingPermission) {
      // The document may have been purged since the item was written;
      // creating a permission for a missing document fails the FK, so
      // verify first. Owner can't be a collaborator on their own doc.
      const doc = await prisma.document.findFirst({
        where: { id: item.documentId, deletedAt: null, ownerId: { not: userId } },
        select: { id: true, title: true, ownerId: true },
      });
      if (doc) {
        const role =
          item.type === INBOX_TYPES.INVITE && typeof item.meta?.role === 'string'
            ? item.meta.role
            : 'EDITOR';
        await prisma.permission.create({
          data: {
            documentId: doc.id,
            userId,
            role: ['EDITOR', 'COMMENTER', 'VIEWER'].includes(role) ? role : 'EDITOR',
            invitedBy: item.inviterId ?? undefined,
          },
        });
        track(EVENTS.DOC_OPENED, {
          user_id: userId,
          document_id: doc.id,
          accepted_invite: true,
        });
      }
    }
    return { ...item, meta, readAt: new Date() };
  } catch (err) {
    // Accept must never hard-fail the UI; surface via the API as a no-op.
    console.warn('[inbox] accept failed:', err.message);
    throw err; // let the API decide (route returns 500 → toast)
  }
}

/** Newest-first inbox page with unread count for the signed-in user. */
export async function listInbox(userId, { cursor = null, limit = DEFAULT_PAGE_SIZE } = {}) {
  const take = Math.min(Math.max(Number(limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const [items, unread] = await Promise.all([
    prisma.inboxItem.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: take + 1, // one extra to detect the next page
      select: {
        id: true,
        type: true,
        documentId: true,
        docTitle: true,
        meta: true,
        readAt: true,
        claimedAt: true,
        createdAt: true,
        inviter: { select: { name: true, email: true, imageUrl: true } },
      },
    }),
    prisma.inboxItem.count({ where: { userId, readAt: null } }),
  ]);

  const hasMore = items.length > take;
  return {
    items: hasMore ? items.slice(0, take) : items,
    unread,
    nextCursor: hasMore ? items[take - 1].id : null,
  };
}

/** Mark items read. `ids: null` marks everything. Returns count updated. */
export async function markInboxRead(userId, ids = null) {
  const result = await prisma.inboxItem.updateMany({
    where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return result.count;
}

/** Delete items. `ids` required — no blanket wipe from the API surface. */
export async function deleteInboxItems(userId, ids) {
  const result = await prisma.inboxItem.deleteMany({
    where: { userId, id: { in: ids } },
  });
  return result.count;
}
