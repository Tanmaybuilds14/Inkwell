/**
 * Tests for the presence identity (lib/presence).
 *
 * Regression cover for the reported bug: caret pills read
 * "User: 3624539184" instead of a name. The broadcast name used to come from
 * Clerk's client-side profile (`user.fullName ?? user.username`), which is
 * empty for an email/password sign-up — and y-tiptap renders a name-less
 * awareness state as `User: <clientId>`. These tests pin the resolution order,
 * and pin that a signed-in collaborator never reaches a peer nameless.
 */
import { describe, it, expect } from "vitest";
import {
  PRESENCE_COLORS,
  buildPresenceUser,
  colorFor,
  resolvePresenceName,
} from "@/lib/presence";

/** The shape y-tiptap renders when the broadcast `user` has no name. */
const placeholderFor = (clientId) => `User: ${clientId}`;

describe("resolvePresenceName", () => {
  it("prefers the Inkwell display name over Clerk's", () => {
    const name = resolvePresenceName({
      profileName: "Tanmay",
      clerkUser: { fullName: "Tanmay Builds", username: "tanmaybuilds14" },
      isSignedIn: true,
      isLoaded: true,
    });
    expect(name).toBe("Tanmay");
  });

  it("falls back to Clerk's full name, then first+last, then username", () => {
    const clerk = (user) =>
      resolvePresenceName({ profileName: null, clerkUser: user, isSignedIn: true, isLoaded: true });

    expect(clerk({ fullName: "Ada Lovelace" })).toBe("Ada Lovelace");
    expect(clerk({ firstName: "Ada", lastName: "Lovelace" })).toBe("Ada Lovelace");
    expect(clerk({ firstName: "Ada" })).toBe("Ada");
    expect(clerk({ username: "ada" })).toBe("ada");
  });

  it("never leaves a signed-in user nameless when Clerk only has an email", () => {
    // An email sign-up with no name anywhere: the case that produced
    // "User: <clientId>" pills. The handle is used, never the full address.
    const name = resolvePresenceName({
      profileName: null,
      clerkUser: {
        fullName: null,
        firstName: null,
        lastName: null,
        username: null,
        primaryEmailAddress: { emailAddress: "tanmaybuilds14@gmail.com" },
      },
      isSignedIn: true,
      isLoaded: true,
    });

    expect(name).toBe("tanmaybuilds14");
    expect(name).not.toContain("@");
    expect(buildPresenceUser({ name, color: "#0ea5e9" })).toEqual({
      name: "tanmaybuilds14",
      color: "#0ea5e9",
    });
  });

  it("ignores whitespace-only names instead of broadcasting a blank pill", () => {
    const name = resolvePresenceName({
      profileName: "   ",
      clerkUser: { fullName: "   ", username: "ada" },
      isSignedIn: true,
      isLoaded: true,
    });
    expect(name).toBe("ada");
  });

  it("trims a name so the pill has no stray spacing", () => {
    expect(
      resolvePresenceName({ profileName: "  Tanmay  ", isSignedIn: true, isLoaded: true })
    ).toBe("Tanmay");
  });

  it("names share-link guests, and only once Clerk has reported in", () => {
    // Signed out, Clerk loaded → a guest.
    expect(
      resolvePresenceName({ profileName: null, clerkUser: null, isSignedIn: false, isLoaded: true })
    ).toBe("Guest");

    // Clerk still loading (isSignedIn undefined): saying "Guest" here is how a
    // signed-in user briefly mislabels themselves to every peer.
    expect(
      resolvePresenceName({ profileName: null, clerkUser: null, isSignedIn: undefined, isLoaded: false })
    ).toBeNull();
  });

  it("stays null only while nothing is known, and says so with a colour", () => {
    const name = resolvePresenceName({ profileName: null, clerkUser: null, isSignedIn: true, isLoaded: true });
    expect(name).toBeNull();
    // A colour-only payload is the transient state; it must still be valid.
    expect(buildPresenceUser({ name, color: "#8b5cf6" })).toEqual({ color: "#8b5cf6" });
  });

  it("resolves a signed-in user without handing peers a client-id placeholder", () => {
    const clientId = 671411280;
    const name = resolvePresenceName({
      profileName: "Tanmay",
      clerkUser: null,
      isSignedIn: true,
      isLoaded: true,
    });
    expect(buildPresenceUser({ name, color: colorFor("user_123") }).name).not.toBe(
      placeholderFor(clientId)
    );
  });
});

describe("colorFor", () => {
  it("is deterministic and always a palette value", () => {
    for (const seed of ["user_1", "user_2", "doc_abc", ""]) {
      expect(colorFor(seed)).toBe(colorFor(seed));
      expect(PRESENCE_COLORS).toContain(colorFor(seed));
    }
  });

  it("only produces 6-digit hex, which is all y-tiptap renders", () => {
    // y-prosemirror warns and substitutes #ffa500 for anything else, so a
    // non-hex palette entry would silently break every caret colour.
    for (const color of PRESENCE_COLORS) expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("survives a missing seed (a guest whose document id is not known yet)", () => {
    expect(PRESENCE_COLORS).toContain(colorFor(undefined));
    expect(PRESENCE_COLORS).toContain(colorFor(null));
  });

  it("spreads different collaborators across the palette", () => {
    const colors = new Set(["user_1", "user_2", "user_3", "user_4", "user_5"].map(colorFor));
    expect(colors.size).toBeGreaterThan(1);
  });
});
