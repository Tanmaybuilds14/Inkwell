import { describe, expect, it } from "vitest";
import { SLASH_ITEMS, slashMatch, filterSlashItems } from "../src/components/editor/slash-command.js";

describe("slashMatch", () => {
  const heading = SLASH_ITEMS.find((i) => i.title === "Heading 1");

  it("matches every item when the query is empty", () => {
    expect(slashMatch(heading, "")).toBe(0);
  });

  it("matches subqueries of the title", () => {
    expect(slashMatch(heading, "head")).toBeGreaterThan(-1);
  });

  it("matches aliases exactly", () => {
    expect(slashMatch(heading, "h1")).toBeGreaterThan(-1);
  });

  it("matches subsequence characters (tbl -> Table)", () => {
    const table = SLASH_ITEMS.find((i) => i.title === "Table");
    expect(slashMatch(table, "tbl")).toBeGreaterThan(-1);
  });

  it("rejects queries whose characters are not in order", () => {
    expect(slashMatch(heading, "zz")).toBe(-1);
  });

  it("ranks exact-prefix aliases above subsequence titles", () => {
    // Typing "h1" should surface "Heading 1" first, not items that merely
    // contain h→1 as a subsequence somewhere in a longer title.
    const ranked = filterSlashItems("h1");
    expect(ranked[0].title).toBe("Heading 1");
  });

  it("ranks 'table' before other items when queried exactly", () => {
    const ranked = filterSlashItems("table");
    expect(ranked[0].title).toBe("Table");
  });
});

describe("filterSlashItems", () => {
  it("returns the full list, in definition order, on empty query", () => {
    const items = filterSlashItems("");
    expect(items).toEqual(SLASH_ITEMS);
  });

  it("narrow to relevant items on a query", () => {
    const items = filterSlashItems("task");
    expect(items.map((i) => i.title)).toContain("To-do list");
    expect(items.length).toBeLessThan(SLASH_ITEMS.length);
  });

  it("returns nothing for a garbage query", () => {
    expect(filterSlashItems("qqqqz")).toEqual([]);
  });

  it("every item has the fields the menu needs", () => {
    for (const item of SLASH_ITEMS) {
      expect(item.title, item.title).toBeTruthy();
      expect(item.group, item.title).toBeTruthy();
      expect(item.description, item.title).toBeTruthy();
      expect(typeof item.command, item.title).toBe("function");
      expect(item.aliases, item.title).toBeInstanceOf(Array);
    }
  });

  it("covers the required feature set", () => {
    const titles = SLASH_ITEMS.map((i) => i.title);
    expect(titles).toContain("To-do list");
    expect(titles).toContain("Table");
    expect(titles).toContain("Code block");
    expect(titles).toContain("Image");
  });
});
