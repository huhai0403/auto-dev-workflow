import { describe, expect, it } from "vitest";
import {
  type CodeReviewResult,
  type ReviewFinding,
  type ReviewerFingerprint,
  renderReviewMarkdown,
} from "./code-reviewer.js";

const baseFingerprint = (
  source: "llm" | "lint" | "no_changes" | "no_lint_script" | "llm_disabled" | "llm_error",
  reviewedFiles: string[] = [],
): ReviewerFingerprint => ({
  source,
  model: source === "llm" ? "gpt-4o-mini" : undefined,
  reviewHash: "abc123def456",
  reviewedAt: "2026-06-05T10:00:00.000Z",
  changedFiles: reviewedFiles,
  lintExecuted: false,
});

describe("code-reviewer", () => {
  describe("renderReviewMarkdown", () => {
    it("renders verdict and summary in the header", () => {
      const result: CodeReviewResult = {
        verdict: "approve",
        summary: "Looks good.",
        findings: [],
        reviewedFiles: ["src/foo.ts"],
        reviewSource: "llm",
        rawOutput: "",
        fingerprint: baseFingerprint("llm", ["src/foo.ts"]),
      };
      const out = renderReviewMarkdown(result);
      expect(out).toContain("APPROVE");
      expect(out).toContain("Looks good.");
      expect(out).toContain("src/foo.ts");
      expect(out).toContain("bmad-fingerprint: source=llm");
    });

    it("groups findings by severity", () => {
      const result: CodeReviewResult = {
        verdict: "changes_requested",
        summary: "Two issues.",
        findings: [
          { severity: "critical", file: "a.ts", description: "Bug" },
          { severity: "major", file: "b.ts", description: "Edge case" },
          { severity: "minor", file: "c.ts", description: "Naming" },
          { severity: "nit", file: "d.ts", description: "Whitespace" },
        ],
        reviewedFiles: [],
        reviewSource: "llm",
        rawOutput: "",
        fingerprint: baseFingerprint("llm"),
      };
      const out = renderReviewMarkdown(result);
      expect(out).toContain("Critical Issues");
      expect(out).toContain("Major Issues");
      expect(out).toContain("Minor Issues");
      expect(out).toContain("Nit Issues");
      expect(out).toContain("CHANGES REQUESTED");
    });

    it("emits a blocked banner when verdict is blocked", () => {
      const out = renderReviewMarkdown({
        verdict: "blocked",
        summary: "Need design call",
        findings: [],
        reviewedFiles: [],
        reviewSource: "llm",
        rawOutput: "",
        fingerprint: baseFingerprint("llm"),
      });
      expect(out).toContain("BLOCKED");
    });
  });

  describe("hardening: no false APPROVE", () => {
    it("lint-only review cannot produce APPROVE", () => {
      const out = renderReviewMarkdown({
        verdict: "changes_requested",
        summary: "Lint-only review — AI review NOT performed.",
        findings: [],
        reviewedFiles: [],
        reviewSource: "lint",
        rawOutput: "lint-only:",
        fingerprint: baseFingerprint("lint"),
      });
      expect(out).toMatch(/CHANGES REQUESTED/);
      expect(out).toMatch(/AI review NOT performed/);
    });

    it("no-changes review cannot produce APPROVE", () => {
      const out = renderReviewMarkdown({
        verdict: "changes_requested",
        summary: "No files",
        findings: [],
        reviewedFiles: [],
        reviewSource: "no_changes",
        rawOutput: "...",
        fingerprint: baseFingerprint("no_changes"),
      });
      expect(out).toMatch(/CHANGES REQUESTED/);
    });

    it("fallback (no LLM, no lint) cannot produce APPROVE", () => {
      const out = renderReviewMarkdown({
        verdict: "changes_requested",
        summary: "Fallback",
        findings: [],
        reviewedFiles: [],
        reviewSource: "llm_disabled",
        rawOutput: "...",
        fingerprint: baseFingerprint("llm_disabled"),
      });
      expect(out).toMatch(/CHANGES REQUESTED/);
    });
  });

  describe("hardening: fingerprint is present", () => {
    it("includes the bmad-fingerprint block required by the audit", () => {
      const out = renderReviewMarkdown({
        verdict: "approve",
        summary: "ok",
        findings: [],
        reviewedFiles: ["a.ts"],
        reviewSource: "llm",
        rawOutput: "raw",
        fingerprint: baseFingerprint("llm", ["a.ts"]),
      });
      expect(out).toMatch(/bmad-fingerprint: source=llm/);
      expect(out).toMatch(/bmad-fingerprint: review_hash=abc123def456/);
      expect(out).toMatch(/bmad-fingerprint: model=gpt-4o-mini/);
    });
  });

  describe("ReviewFinding shape", () => {
    it("allows a finding without a file", () => {
      const f: ReviewFinding = { severity: "major", description: "Architecture" };
      expect(f.file).toBeUndefined();
    });
  });
});

