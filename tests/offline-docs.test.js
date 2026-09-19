import { describe, expect, it } from "vitest";
import { offlineDbName } from "../src/lib/offline-docs.js";

describe("offlineDbName", () => {
  it("keys a signed-in user's cache by user id", () => {
    expect(offlineDbName("doc1", { userId: "user_abc" })).toBe(
      "inkwell-doc-doc1-user_abc"
    );
  });

  it("keys a guest's cache by the signed share token", () => {
    expect(offlineDbName("doc1", { shareToken: "tok123" })).toBe(
      "inkwell-doc-doc1-share-tok123"
    );
  });

  it("prefers the user id over the share token when both exist", () => {
    // A signed-in user who followed a share link has both; their account
    // identity is the stable one — the token can be rotated.
    expect(offlineDbName("doc1", { userId: "user_abc", shareToken: "tok123" })).toBe(
      "inkwell-doc-doc1-user_abc"
    );
  });

  it("refuses to cache when there is no identity", () => {
    // An unidentifiable viewer can neither be shown their own stale copy
    // later nor securely excluded from someone else's cache.
    expect(offlineDbName("doc1", {})).toBeNull();
    expect(offlineDbName("doc1", { userId: null, shareToken: null })).toBeNull();
  });

  it("refuses to cache without a document id", () => {
    expect(offlineDbName(null, { userId: "user_abc" })).toBeNull();
    expect(offlineDbName(undefined, { shareToken: "tok123" })).toBeNull();
  });

  it("produces distinct keys for different viewers of the same document", () => {
    const a = offlineDbName("doc1", { userId: "user_a" });
    const b = offlineDbName("doc1", { userId: "user_b" });
    expect(a).not.toBe(b);
  });
});
