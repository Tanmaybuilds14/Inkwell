import crypto from 'node:crypto';
import { verifyToken } from '@clerk/backend';
import {
  getDocumentForAuth,
  getUserByClerkId,
  getUserRoleForDocument,
} from './db.js';

/**
 * Timing-safe string comparison to prevent timing attacks on bearer tokens
 * (share tokens). Falls back to false on length mismatch without throwing.
 * Cross-reference: src/lib/permissions.js has the equivalent function.
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return crypto.timingSafeEqual(bufA, bufB);
}

const GUEST_NAMES = ['Guest Wren', 'Guest Finch', 'Guest Heron', 'Guest Swift', 'Guest Lark'];

/**
 * Validates a WebSocket handshake and resolves the caller's role for the
 * document. Two paths:
 *   1. Clerk JWT (signed-in users) — the same token the web app validates.
 *   2. Share link token (guest collaborators).
 *
 * Fail-closed: any error denies access.
 */
export async function authenticateHandshake({ docId, token, shareToken }) {
  if (!docId) return { ok: false, code: 4001, reason: 'docId is required' };

  const doc = await getDocumentForAuth(docId);
  if (!doc || doc.deletedAt) return { ok: false, code: 4004, reason: 'Document not found' };

  // Path 1: signed-in user.
  if (token) {
    try {
      const claims = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY,
      });
      const user = await getUserByClerkId(claims.sub);
      if (!user) return { ok: false, code: 4003, reason: 'Unknown user' };

      let role = null;
      if (doc.ownerId === user.id) role = 'OWNER';
      else role = await getUserRoleForDocument(docId, user.id);

      if (!role) return { ok: false, code: 4003, reason: 'No access to this document' };
      return {
        ok: true,
        identity: {
          userId: user.id,
          name: user.name ?? user.email,
          color: colorFor(user.id),
          guest: false,
        },
        role,
      };
    } catch (err) {
      console.error('[auth] clerk token rejected:', err.message);
      // Distinguish expired/invalid tokens (4010) from other auth failures
      // (4001) so the client can specifically refresh its token and retry.
      const isExpired = err.message?.includes('expired') || err.message?.includes('token has expired');
      return { ok: false, code: isExpired ? 4010 : 4001, reason: 'Invalid token' };
    }
  }

  // Path 2: guest via active share link.
  if (shareToken && doc.shareEnabled && timingSafeEqual(doc.shareToken, shareToken)) {
    return {
      ok: true,
      identity: {
        userId: `guest:${randomId()}`,
        name: GUEST_NAMES[Math.floor(Math.random() * GUEST_NAMES.length)],
        color: colorFor(shareToken + Math.random()),
        guest: true,
      },
      role: doc.shareRole,
    };
  }

  return { ok: false, code: 4003, reason: 'Access denied' };
}

function colorFor(seedStr) {
  const PALETTE = [
    '#0ea5e9', '#8b5cf6', '#ec4899', '#f59e0b',
    '#10b981', '#ef4444', '#6366f1', '#14b8a6',
  ];
  let hash = 0;
  for (let i = 0; i < seedStr.length; i++) {
    hash = (hash * 31 + seedStr.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}
