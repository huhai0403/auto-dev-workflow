import { describe, expect, it } from "vitest";
import {
  batchNamesMatch,
  createWorkflowId,
  formatDuration,
  joinPath,
  normalizeBatchName,
  nowIso,
  slugify,
  truncate,
} from "./utils.js";

describe("utils", () => {
  describe("slugify", () => {
    it("lowercases and replaces whitespace with hyphens", () => {
      expect(slugify("Hello World")).toBe("hello-world");
    });

    it("strips leading and trailing hyphens", () => {
      expect(slugify("  ---foo bar---  ")).toBe("foo-bar");
    });

    it("preserves Chinese characters", () => {
      expect(slugify("用户登录 模块")).toBe("用户登录-模块");
    });

    it("falls back to 'feature' for empty input", () => {
      expect(slugify("")).toBe("feature");
      expect(slugify("---")).toBe("feature");
    });

    it("truncates long input to 48 characters", () => {
      const long = "a".repeat(200);
      const slug = slugify(long);
      expect(slug.length).toBeLessThanOrEqual(48);
    });
  });

  describe("truncate", () => {
    it("returns input as-is when under max", () => {
      expect(truncate("hello", 10)).toBe("hello");
    });

    it("appends ellipsis when over max", () => {
      const result = truncate("a".repeat(20), 5);
      expect(result).toMatch(/^aaaaa\u2026$/);
    });

    it("respects custom max", () => {
      expect(truncate("abcdef", 3)).toHaveLength(4);
    });
  });

  describe("joinPath", () => {
    it("joins path segments", () => {
      const result = joinPath("a", "b", "c");
      expect(result.endsWith(`${require("node:path").sep}b${require("node:path").sep}c`)).toBe(true);
    });

    it("handles absolute base", () => {
      const result = joinPath("/tmp", "foo");
      expect(result).toContain("foo");
    });
  });

  describe("formatDuration", () => {
    it("formats sub-second as ms", () => {
      expect(formatDuration(500)).toBe("500ms");
    });

    it("formats seconds with 1 decimal", () => {
      expect(formatDuration(1500)).toBe("1.5s");
    });

    it("formats minutes and seconds", () => {
      expect(formatDuration(125_000)).toBe("2m 5s");
    });
  });

  describe("nowIso", () => {
    it("returns a parseable ISO string", () => {
      const result = nowIso();
      expect(() => new Date(result).toISOString()).not.toThrow();
    });
  });

  describe("createWorkflowId", () => {
    it("matches expected pattern", () => {
      const id = createWorkflowId();
      expect(id).toMatch(/^bmad-\d{8}-[a-z0-9]{8}$/);
    });
  });

  describe("normalizeBatchName and batchNamesMatch", () => {
    it("normalizes dots and case", () => {
      expect(normalizeBatchName("v.1.3.13 Editor")).toBe("v1313-editor");
    });

    it("matches with dot variation", () => {
      expect(batchNamesMatch("v.1.3.13-editor-update", "v1.3.13-editor-update")).toBe(true);
    });

    it("matches with case variation", () => {
      expect(batchNamesMatch("v1.3.13-Editor-Update", "v1.3.13-editor-update")).toBe(true);
    });

    it("matches by containment", () => {
      expect(batchNamesMatch("feature-foo-bar", "foo-bar")).toBe(true);
    });

    it("rejects non-matching names", () => {
      expect(batchNamesMatch("v1-foo", "v2-bar")).toBe(false);
    });
  });
});
