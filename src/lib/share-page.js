import { prisma } from '@/lib/prisma';
import {
  SHARE_TOKEN_PATTERN,
  isShareTokenShape,
} from '../../shared/share-token.js';

/**
 * The data behind `/share/[token]` — a server-rendered, read-only view of a
 * document reachable by anyone holding the link, no account required.
 *
 * Kept out of the page component so the access rules can be unit tested
 * without rendering React: everything a caller needs to decide "does this
 * token open anything, and what?" lives here.
 *
 * The token's *shape* is defined in shared/share-token.js because the proxy
 * needs it too, and must be able to ask that question without loading this
 * module (and therefore the database client) into its bundle.
 */
// Re-exported because this is the module the page and its tests have always
// imported them from; the definition lives in shared/share-token.js.
export { SHARE_TOKEN_PATTERN, isShareTokenShape };

/**
 * Resolve a share token to the document it opens, or null.
 *
 * Null covers every refusal — unknown token, revoked link, trashed document —
 * exactly like the API's 404 does, so a caller cannot tell "this document
 * never existed" from "this link was turned off". Holders of a revoked link
 * learn nothing about the document they used to be able to read.
 *
 * The lookup is a single equality match on the unique `shareToken` index.
 * There is no constant-time comparison here on purpose: the value compared is
 * the *database's*, not an attacker-supplied guess, and a B-tree lookup is not
 * a byte-wise comparison an attacker can time over the network.
 */
export async function getSharedDocument(token, { withContent = false } = {}) {
  if (!isShareTokenShape(token)) return null;

  const doc = await prisma.document.findFirst({
    where: { shareToken: token, shareEnabled: true, deletedAt: null },
    select: {
      id: true,
      title: true,
      shareRole: true,
      updatedAt: true,
      owner: { select: { name: true, email: true } },
      // The snapshot is the whole document; only the page body needs it, and
      // generateMetadata should not drag it out of the database.
      ...(withContent ? { snapshot: true } : {}),
    },
  });

  return doc ?? null;
}

/**
 * Does this token currently open a document?
 *
 * The proxy's pre-flight: one indexed lookup of the token, selecting an id and
 * nothing else. Kept separate from getSharedDocument on purpose — the proxy
 * must not drag a document's content across the wire to answer a boolean, and
 * "does it exist" is the only question it is allowed to ask.
 */
export async function shareTokenExists(token) {
  if (!isShareTokenShape(token)) return false;
  const doc = await prisma.document.findFirst({
    where: { shareToken: token, shareEnabled: true, deletedAt: null },
    select: { id: true },
  });
  return !!doc;
}

/** The public page URL for a token, given the deployment's app URL. */
export function sharePageUrl(token, appUrl) {
  if (!token) return null;
  return `${appUrl.replace(/\/+$/, '')}/share/${token}`;
}

/** Display name for the sharing owner, without assuming either field exists. */
export function ownerDisplayName(owner) {
  const name = owner?.name?.trim();
  if (name) return name;
  const email = owner?.email?.trim();
  if (!email) return null;
  // An email is not a display name; the local part reads better than the
  // whole address on a page anyone with the link can see.
  return email.split('@')[0];
}
