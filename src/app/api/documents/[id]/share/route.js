import crypto from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { handle, apiError, json, requireDocument } from '@/lib/api-helpers';
import { track, EVENTS } from '@/lib/telemetry';
import { ROLES } from '@/lib/permissions';

const VALID_ROLES = new Set([ROLES.EDITOR, ROLES.COMMENTER, ROLES.VIEWER]);

/** GET — collaborator list + link-sharing status. Owner only. */
export async function GET(request, { params }) {
  return handle(async () => {
    const { id } = await params;
    const { user } = await requireDocument(request, id, 'OWNER');

    const doc = await prisma.document.findUnique({
      where: { id },
      select: {
        ownerId: true,
        shareEnabled: true,
        shareRole: true,
        shareToken: true,
        owner: { select: { id: true, name: true, email: true } },
        permissions: {
          select: {
            id: true,
            role: true,
            invitedEmail: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    const collaborators = [
      {
        permissionId: null,
        userId: doc.owner.id,
        name: doc.owner.name ?? doc.owner.email,
        email: doc.owner.email,
        role: 'OWNER',
      },
      ...doc.permissions.map((p) => ({
        permissionId: p.id,
        userId: p.user.id,
        name: p.user.name ?? p.user.email,
        email: p.user.email,
        role: p.role,
        pending: !p.user.clerkId || p.user.clerkId.startsWith('pending_'),
      })),
    ];

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
    return json({
      collaborators,
      link: doc.shareEnabled
        ? {
            enabled: true,
            role: doc.shareRole,
            url: `${appUrl}/documents/${id}?share=${doc.shareToken}`,
          }
        : { enabled: false, role: null, url: null },
    });
  });
}

/** POST — invite by email with a role. Owner only. */
export async function POST(request, { params }) {
  return handle(async () => {
    const { id } = await params;
    const { user } = await requireDocument(request, id, 'OWNER');

    const body = await request.json().catch(() => ({}));
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const role = body.role ?? 'VIEWER';
    if (!email || !email.includes('@')) return apiError(400, 'Valid email is required');
    if (!VALID_ROLES.has(role)) return apiError(400, 'Invalid role');

    // Provision a pending user row so the permission exists before first
    // sign-in; ensureUser claims it once the real Clerk account appears.
    let invitee = await prisma.user.findFirst({ where: { email } });
    if (!invitee) {
      invitee = await prisma.user.create({
        data: { clerkId: `pending_${crypto.randomUUID()}`, email },
      });
    }

    const doc = await prisma.document.findUnique({
      where: { id },
      select: { title: true },
    });

    const permission = await prisma.permission.upsert({
      where: { documentId_userId: { documentId: id, userId: invitee.id } },
      update: { role, invitedEmail: email },
      create: {
        documentId: id,
        userId: invitee.id,
        role,
        invitedEmail: email,
        invitedBy: user.id,
      },
      select: { id: true, role: true },
    });

    track(EVENTS.DOC_SHARED, {
      document_id: id,
      role,
      invite_type: 'email',
      actor_id: user.id,
    });

    await inngestSendInvite({
      documentId: id,
      documentTitle: doc.title,
      inviteeEmail: email,
      inviterName: user.name ?? user.email,
      role: permission.role,
      inviteType: 'email',
    });

    return json(
      {
        permission: {
          permissionId: permission.id,
          email,
          role: permission.role,
          pending: true,
        },
      },
      { status: 201 }
    );
  });
}

async function inngestSendInvite(data) {
  const { inngest } = await import('@/lib/inngest');
  await inngest.send({ name: 'inkwell/document.shared', data });
}

/** PATCH — change a collaborator's role or manage the share link. Owner only. */
export async function PATCH(request, { params }) {
  return handle(async () => {
    const { id } = await params;
    await requireDocument(request, id, 'OWNER');
    const body = await request.json().catch(() => ({}));

    if ('permissionId' in body) {
      if (typeof body.role !== 'string' || !VALID_ROLES.has(body.role)) {
        return apiError(400, 'Invalid role');
      }
      const existing = await prisma.permission.findFirst({
        where: { id: body.permissionId, documentId: id },
        select: { id: true, userId: true },
      });
      if (!existing) return apiError(404, 'Collaborator not found');

      await prisma.permission.update({
        where: { id: existing.id },
        data: { role: body.role },
      });
      track(EVENTS.DOC_PERMISSION_CHANGED, {
        document_id: id,
        permission_id: existing.id,
        role: body.role,
      });
      return json({ ok: true });
    }

    if ('linkEnabled' in body) {
      const data = {};
      if (body.linkEnabled) {
        data.shareEnabled = true;
        if (typeof body.linkRole === 'string') {
          if (!VALID_ROLES.has(body.linkRole)) return apiError(400, 'Invalid link role');
          data.shareRole = body.linkRole;
        }
        // Mint a token on first enable.
        data.shareToken = crypto.randomBytes(24).toString('base64url');
      } else {
        // Revoke: disable AND rotate the token — old links die immediately.
        data.shareEnabled = false;
        data.shareToken = crypto.randomBytes(24).toString('base64url');
      }

      const updated = await prisma.document.update({
        where: { id },
        data,
        select: { shareEnabled: true, shareRole: true, shareToken: true },
      });

      track(
        body.linkEnabled ? EVENTS.DOC_SHARED : EVENTS.DOC_LINK_REVOKED,
        { document_id: id, invite_type: 'link', role: updated.shareRole }
      );

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
      return json({
        link: updated.shareEnabled
          ? {
              enabled: true,
              role: updated.shareRole,
              url: `${appUrl}/documents/${id}?share=${updated.shareToken}`,
            }
          : { enabled: false, role: null, url: null },
      });
    }

    return apiError(400, 'Nothing to update');
  });
}

/** DELETE — remove a collaborator (?permissionId=...). Owner only. */
export async function DELETE(request, { params }) {
  return handle(async () => {
    const { id } = await params;
    await requireDocument(request, id, 'OWNER');

    const url = new URL(request.url);
    const permissionId = url.searchParams.get('permissionId');
    if (!permissionId) return apiError(400, 'permissionId is required');

    const deleted = await prisma.permission.deleteMany({
      where: { id: permissionId, documentId: id },
    });
    if (deleted.count === 0) return apiError(404, 'Collaborator not found');

    track(EVENTS.DOC_PERMISSION_CHANGED, {
      document_id: id,
      permission_id: permissionId,
      removed: true,
    });
    return json({ ok: true });
  });
}
