import { describe, expect, it } from "vitest";
import {
  type EvidenceCheckResult,
  renderAuditMarkdown,
  summarizeEvidence,
  verifyStoryContent,
} from "./evidence-verifier.js";

const FULL_PASS_STORY = `# Story 1-1: Do a thing

## Test Output
<!-- bmad-evidence:test step=testing at=2026-06-05T10:00:00Z workflow=wf-1 -->
\`\`\`
PASS  src/foo.test.ts
Tests: 5 passed, 5 total
\`\`\`

## Lint Output
<!-- bmad-evidence:lint step=code_review_pipeline at=2026-06-05T10:00:01Z workflow=wf-1 -->
\`\`\`
0 errors, 0 warnings
\`\`\`

## Code Review Summary
<!-- bmad-evidence:review step=code_review_pipeline at=2026-06-05T10:00:02Z workflow=wf-1 -->
\`\`\`
bmad-fingerprint: source=llm
bmad-fingerprint: review_hash=abc123def456
bmad-fingerprint: model=gpt-4o-mini
bmad-fingerprint: reviewed_at=2026-06-05T10:00:02Z
bmad-fingerprint: lint_executed=true
bmad-fingerprint: file_count=2
\`\`\`
Verdict: APPROVE
No critical issues.

## Definition of Done
- [x] AC1 implemented
- [x] AC2 implemented
- [x] Tests pass
`;

describe("evidence-verifier", () => {
  describe("verifyStoryContent", () => {
    it("passes all 4 checks for a complete story", () => {
      const checks = verifyStoryContent(FULL_PASS_STORY);
      expect(checks).toHaveLength(4);
      expect(checks.every((c) => c.passed)).toBe(true);
    });

    it("fails when test output is missing", () => {
      const story = FULL_PASS_STORY.replace(/## Test Output[\s\S]*?(?=## Lint Output)/, "");
      const checks = verifyStoryContent(story);
      const testCheck = checks.find((c) => c.name === "test_output");
      expect(testCheck?.passed).toBe(false);
    });

    it("fails when test output is placeholder text", () => {
      const story = FULL_PASS_STORY.replace(
        "PASS  src/foo.test.ts\nTests: 5 passed, 5 total",
        "Skipped (no test:unit script)",
      );
      const checks = verifyStoryContent(story);
      const testCheck = checks.find((c) => c.name === "test_output");
      expect(testCheck?.passed).toBe(false);
    });

    it("fails when lint section is empty", () => {
      const story = FULL_PASS_STORY.replace("0 errors, 0 warnings", "");
      const checks = verifyStoryContent(story);
      const lint = checks.find((c) => c.name === "lint_output");
      expect(lint?.passed).toBe(false);
    });

    it("fails when user-typed lint section has no sentinel even with content", () => {
      const userTyped = `# Story 1-1: Do a thing

## Lint Output
\`\`\`
0 errors, 0 warnings
\`\`\`
`;
      const checks = verifyStoryContent(userTyped);
      const lint = checks.find((c) => c.name === "lint_output");
      expect(lint?.passed).toBe(false);
      expect(lint?.details).toMatch(/sentinel/);
    });

    it("fails when code review is missing", () => {
      const story = FULL_PASS_STORY.replace(/## Code Review Summary[\s\S]*?(?=## Definition of Done)/, "");
      const checks = verifyStoryContent(story);
      const cr = checks.find((c) => c.name === "code_review_summary");
      expect(cr?.passed).toBe(false);
    });

    it("fails when code review verdict is BLOCKED", () => {
      const story = FULL_PASS_STORY.replace("Verdict: APPROVE", "Verdict: BLOCKED");
      const checks = verifyStoryContent(story);
      const cr = checks.find((c) => c.name === "code_review_summary");
      expect(cr?.passed).toBe(false);
    });

    it("passes code review when verdict is CHANGES REQUESTED (work is acknowledged)", () => {
      const story = FULL_PASS_STORY.replace(
        "Verdict: APPROVE",
        "Verdict: CHANGES REQUESTED — fixed in next iteration",
      );
      const checks = verifyStoryContent(story);
      const cr = checks.find((c) => c.name === "code_review_summary");
      expect(cr?.passed).toBe(true);
    });

    it("fails code review when fingerprint source is not 'llm'", () => {
      const story = FULL_PASS_STORY.replace(
        "bmad-fingerprint: source=llm",
        "bmad-fingerprint: source=lint",
      );
      const checks = verifyStoryContent(story);
      const cr = checks.find((c) => c.name === "code_review_summary");
      expect(cr?.passed).toBe(false);
      expect(cr?.details).toMatch(/not 'llm'/);
    });

    it("fails code review when fingerprint block is missing entirely", () => {
      const story = FULL_PASS_STORY.replace(
        /```\nbmad-fingerprint:[^`]*```/,
        "```\nNo fingerprint here.\n```",
      );
      const checks = verifyStoryContent(story);
      const cr = checks.find((c) => c.name === "code_review_summary");
      expect(cr?.passed).toBe(false);
      expect(cr?.details).toMatch(/fingerprint/);
    });

    it("fails test_output when sentinel is missing", () => {
      const story = FULL_PASS_STORY.replace(
        /<!-- bmad-evidence:test[^>]*-->\n/,
        "",
      );
      const checks = verifyStoryContent(story);
      const c = checks.find((c) => c.name === "test_output");
      expect(c?.passed).toBe(false);
      expect(c?.details).toMatch(/sentinel/);
    });

    it("fails lint_output when sentinel is missing", () => {
      const story = FULL_PASS_STORY.replace(
        /<!-- bmad-evidence:lint[^>]*-->\n/,
        "",
      );
      const checks = verifyStoryContent(story);
      const c = checks.find((c) => c.name === "lint_output");
      expect(c?.passed).toBe(false);
      expect(c?.details).toMatch(/sentinel/);
    });

    it("fails DoD when any item is unchecked", () => {
      const story = FULL_PASS_STORY.replace("- [x] AC2 implemented", "- [ ] AC2 implemented");
      const checks = verifyStoryContent(story);
      const dod = checks.find((c) => c.name === "dod_checklist");
      expect(dod?.passed).toBe(false);
    });

    it("fails DoD when there are no checklist items at all", () => {
      const story = FULL_PASS_STORY.replace(
        /## Definition of Done[\s\S]*$/,
        "## Definition of Done\n\nNo items.",
      );
      const checks = verifyStoryContent(story);
      const dod = checks.find((c) => c.name === "dod_checklist");
      expect(dod?.passed).toBe(false);
    });

    it("fails all checks on empty content", () => {
      const checks = verifyStoryContent("");
      expect(checks.every((c) => !c.passed)).toBe(true);
    });
  });

  describe("summarizeEvidence", () => {
    it("returns passed=true when all required checks pass", () => {
      const checks: EvidenceCheckResult[] = EVIDENCE_CHECKS.map((n) => ({
        name: n,
        required: true,
        passed: true,
        details: "ok",
      }));
      const summary = summarizeEvidence(checks);
      expect(summary.passed).toBe(true);
      expect(summary.missingRequired).toEqual([]);
    });

    it("returns missing names when checks fail", () => {
      const checks: EvidenceCheckResult[] = [
        { name: "test_output", required: true, passed: true, details: "ok" },
        { name: "lint_output", required: true, passed: false, details: "x" },
        { name: "code_review_summary", required: true, passed: true, details: "ok" },
        { name: "dod_checklist", required: true, passed: false, details: "x" },
      ];
      const summary = summarizeEvidence(checks);
      expect(summary.passed).toBe(false);
      expect(summary.missingRequired).toEqual(["lint_output", "dod_checklist"]);
    });
  });

  describe("renderAuditMarkdown", () => {
    it("emits per-story results table", () => {
      const md = renderAuditMarkdown({
        reports: [
          {
            storyKey: "1-1",
            checks: [
              { name: "test_output", required: true, passed: true, details: "ok" },
              { name: "lint_output", required: true, passed: false, details: "missing" },
              { name: "code_review_summary", required: true, passed: true, details: "ok" },
              { name: "dod_checklist", required: true, passed: true, details: "ok" },
            ],
            passed: false,
            missingRequired: ["lint_output"],
            requeued: true,
          },
        ],
        allPassed: false,
        failedStoryKeys: ["1-1"],
        requeuedStoryKeys: ["1-1"],
      });
      expect(md).toContain("Completion Audit");
      expect(md).toContain("1-1");
      expect(md).toContain("lint_output");
      expect(md).toContain("Re-queued Stories");
    });
  });
});

const EVIDENCE_CHECKS = [
  "test_output",
  "lint_output",
  "code_review_summary",
  "dod_checklist",
] as const;
