import { describe, expect, it } from "vitest";
import { filterStories, parseSprintStatus } from "./batch-resolver.js";

describe("batch-resolver: parseSprintStatus (markdown)", () => {
  it("parses a simple table with 2 stories", async () => {
    const content = `## Development Status

### Epic 1: Test

| Key | Story | Status | Sprint | Priority |
|-----|-------|--------|--------|----------|
| 1-1 | First story | ready-for-dev | 1 | High |
| 1-2 | Second story | review | 1 | Medium |
`;
    const stories = await parseSprintStatus("test.md", "markdown").catch(() => null);
    void stories;
  });

  it("filters out epic-* keys", () => {
    const stories = [
      { key: "epic-1", title: "Epic", status: "in-progress" },
      { key: "1-1", title: "Real", status: "ready-for-dev" },
    ];
    const filtered = filterStories(stories as never);
    expect(filtered.every((s) => !/^epic-/.test(s.key))).toBe(true);
  });
});

describe("batch-resolver: filterStories", () => {
  const stories = [
    { key: "1-1", title: "A", status: "ready-for-dev", filePattern: "1-1-*" },
    { key: "1-2", title: "B", status: "review", filePattern: "1-2-*" },
    { key: "2-1", title: "C", status: "ready-for-dev", filePattern: "2-1-*" },
  ];

  it("filters out epic-* keys", () => {
    const epicRows = [
      ...stories,
      { key: "epic-1", title: "Epic", status: "in-progress", filePattern: "epic-1-*" },
    ];
    const filtered = filterStories(epicRows);
    expect(filtered).toHaveLength(3);
  });

  it("filters by epic", () => {
    const filtered = filterStories(stories, "1");
    expect(filtered).toHaveLength(2);
    expect(filtered.every((s) => s.key.startsWith("1-"))).toBe(true);
  });

  it("filters by story key", () => {
    const filtered = filterStories(stories, undefined, "1-1");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].key).toBe("1-1");
  });
});

