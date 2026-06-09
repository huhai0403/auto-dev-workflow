import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ReviewVerdict = "approve" | "changes_requested" | "blocked";

export type ReviewSource =
  | "llm"
  | "lint"
  | "no_changes"
  | "no_lint_script"
  | "llm_disabled"
  | "llm_error";

export interface ReviewFinding {
  severity: "critical" | "major" | "minor" | "nit";
  file?: string;
  description: string;
}

export interface ReviewerFingerprint {
  source: ReviewSource;
  model?: string;
  reviewHash: string;
  reviewedAt: string;
  changedFiles: string[];
  lintExecuted: boolean;
}

export interface CodeReviewResult {
  verdict: ReviewVerdict;
  summary: string;
  findings: ReviewFinding[];
  reviewedFiles: string[];
  reviewSource: ReviewSource;
  rawOutput: string;
  lintOutput?: string;
  fingerprint: ReviewerFingerprint;
}

export interface AiCodeReviewOptions {
  projectRoot: string;
  storyKey?: string;
  storyTitle?: string;
  storyFilePath?: string;
  changedFiles?: string[];
  lintOutput?: string;
  maxFiles?: number;
  maxFileSizeBytes?: number;
}

const REVIEW_SYSTEM_PROMPT = `You are a senior staff engineer performing a thorough adversarial code review via the host /bmad-code-review skill.

Your job is to find real issues — security holes, race conditions, broken error handling, performance regressions, contract violations, missing tests for non-trivial logic. Do NOT invent issues just to look thorough. If the code is clean, say so and approve.

Output ONLY valid Markdown with the following sections (omit empty sections):

## Summary
One paragraph describing what changed and overall quality.

## Critical Issues
- [CRITICAL] file:line — description

## Major Issues
- [MAJOR] file:line — description

## Minor Issues
- [MINOR] file:line — description

## Nits
- [NIT] file:line — description

## Verdict
End with exactly ONE of these lines on its own line:
VERDICT: approve
VERDICT: changes_requested
VERDICT: blocked

- "approve" = ship it
- "changes_requested" = real issues that should be fixed
- "blocked" = unfixable without more context or design decisions

When the host /bmad-code-review skill rewrites this section, it MUST also rewrite the
\`bmad-fingerprint\` block with \`source=llm\` and a fresh \`review_hash\`. The MCP server's
initial lint-only fingerprint is always \`source=lint\`, which the evidence gate rejects
for APPROVE.`;

const FILE_EXCLUDES = [
  /node_modules\//,
  /\.git\//,
  /dist\//,
  /build\//,
  /coverage\//,
  /\.next\//,
  /\.nuxt\//,
  /\.cache\//,
  /\.bmad-output\//,
  /_bmad-output\//,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
];

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp3",
  ".mp4",
  ".mov",
  ".webp",
]);

function isExcluded(filePath: string): boolean {
  return FILE_EXCLUDES.some((re) => re.test(filePath));
}

function isBinary(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

export async function detectChangedFiles(
  projectRoot: string,
  maxFiles = 25,
): Promise<string[]> {
  const candidates: string[] = [];

  const tryGit = async (args: string[]): Promise<string[] | null> => {
    try {
      const { stdout } = await execFileAsync("git", args, {
        cwd: projectRoot,
        timeout: 10_000,
      });
      return stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, maxFiles);
    } catch {
      return null;
    }
  };

  const staged = await tryGit(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
  if (staged) candidates.push(...staged);
  const unstaged = await tryGit(["diff", "--name-only", "--diff-filter=ACMR"]);
  if (unstaged) candidates.push(...unstaged);
  const untracked = await tryGit(["ls-files", "--others", "--exclude-standard"]);
  if (untracked) candidates.push(...untracked);

  const unique = [...new Set(candidates)]
    .filter((f) => !isExcluded(f))
    .filter((f) => !isBinary(f))
    .slice(0, maxFiles);

  return unique;
}

function makeFingerprint(
  source: ReviewSource,
  rawOutput: string,
  changedFiles: string[],
  lintExecuted: boolean,
): ReviewerFingerprint {
  return {
    source,
    reviewHash: createHash("sha256")
      .update(`${source}|${rawOutput}|${changedFiles.join(",")}|${lintExecuted ? "1" : "0"}`)
      .digest("hex")
      .slice(0, 16),
    reviewedAt: new Date().toISOString(),
    changedFiles,
    lintExecuted,
  };
}

function renderLintOnlyReview(opts: {
  lintOutput: string;
  reviewedFiles: string[];
  lintExecuted: boolean;
}): CodeReviewResult {
  const findings: ReviewFinding[] = [];
  const lines = opts.lintOutput.split("\n");
  let hasError = false;
  for (const line of lines) {
    const m = line.match(/^(.+?):(\d+):(\d+)\s+(error|warning)\s+(.+?)\s+(.+)$/);
    if (m) {
      const [, file, , , level, rule, msg] = m;
      if (level === "error") hasError = true;
      findings.push({
        severity: level === "error" ? "major" : "minor",
        file: path.basename(file),
        description: `[${rule}] ${msg}`,
      });
    }
  }
  const rawOutput = `lint-only:${opts.lintOutput}`;
  return {
    verdict: "changes_requested",
    summary: `Lint-only review — AI review NOT performed. ${findings.length} lint finding(s). Verdict is CHANGES_REQUESTED; run the host \`/bmad-code-review\` skill to produce an LLM review and rewrite the Code Review Summary section with a \`source=llm\` fingerprint to get an APPROVE.`,
    findings,
    reviewedFiles: opts.reviewedFiles,
    reviewSource: "lint",
    rawOutput,
    lintOutput: opts.lintOutput,
    fingerprint: makeFingerprint("lint", rawOutput, opts.reviewedFiles, opts.lintExecuted),
  };
}

function renderFallbackReview(opts: {
  reviewedFiles: string[];
  reason: string;
  source: ReviewSource;
  lintOutput?: string;
  lintExecuted: boolean;
}): CodeReviewResult {
  return {
    verdict: "changes_requested",
    summary: `${opts.reason} Verdict is CHANGES_REQUESTED, not APPROVE — story cannot be marked done until the host \`/bmad-code-review\` skill runs and rewrites the Code Review Summary section with a \`source=llm\` fingerprint.`,
    findings: [],
    reviewedFiles: opts.reviewedFiles,
    reviewSource: opts.source,
    rawOutput: opts.reason,
    lintOutput: opts.lintOutput,
    fingerprint: makeFingerprint(
      opts.source,
      opts.reason,
      opts.reviewedFiles,
      opts.lintExecuted,
    ),
  };
}

export async function runAiCodeReview(
  options: AiCodeReviewOptions,
): Promise<CodeReviewResult> {
  const maxFiles = options.maxFiles ?? 25;
  const maxFileSizeBytes = options.maxFileSizeBytes ?? 60_000;

  const changedFiles =
    options.changedFiles && options.changedFiles.length > 0
      ? options.changedFiles.filter((f) => !isExcluded(f) && !isBinary(f)).slice(0, maxFiles)
      : await detectChangedFiles(options.projectRoot, maxFiles);

  const lintOutput = options.lintOutput;
  const lintExecuted = Boolean(lintOutput);

  if (changedFiles.length === 0) {
    return renderFallbackReview({
      reviewedFiles: [],
      reason:
        "No changed files detected (not a git repo or no diff). Cannot review what does not exist.",
      source: "no_changes",
      lintOutput,
      lintExecuted,
    });
  }

  if (lintOutput) {
    return renderLintOnlyReview({
      lintOutput,
      reviewedFiles: changedFiles,
      lintExecuted,
    });
  }

  return renderFallbackReview({
    reviewedFiles: changedFiles,
    reason:
      "No lint output available. Run the host `/bmad-code-review` skill to produce an LLM review and rewrite the Code Review Summary section with a `source=llm` fingerprint.",
    source: "no_lint_script",
    lintOutput,
    lintExecuted,
  });
}

export function renderReviewMarkdown(result: CodeReviewResult): string {
  const lines: string[] = [];
  lines.push(`# AI Code Review Report`);
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Verdict | **${result.verdict.toUpperCase()}** |`);
  lines.push(`| Source | ${result.reviewSource} |`);
  lines.push(`| Reviewer | ${result.fingerprint.model ?? "(no LLM)"} |`);
  lines.push(`| Review hash | \`${result.fingerprint.reviewHash}\` |`);
  lines.push(`| Reviewed at | ${result.fingerprint.reviewedAt} |`);
  lines.push(`| Lint executed | ${result.fingerprint.lintExecuted ? "yes" : "no"} |`);
  lines.push(`| Files reviewed | ${result.reviewedFiles.length} |`);
  lines.push(`| Findings | ${result.findings.length} (${result.findings.filter((f) => f.severity === "critical").length} critical, ${result.findings.filter((f) => f.severity === "major").length} major, ${result.findings.filter((f) => f.severity === "minor").length} minor) |`);
  lines.push("");
  lines.push(`## Reviewer Fingerprint (do not edit)`);
  lines.push("```");
  lines.push(`bmad-fingerprint: source=${result.fingerprint.source}`);
  lines.push(`bmad-fingerprint: review_hash=${result.fingerprint.reviewHash}`);
  if (result.fingerprint.model) {
    lines.push(`bmad-fingerprint: model=${result.fingerprint.model}`);
  }
  lines.push(`bmad-fingerprint: reviewed_at=${result.fingerprint.reviewedAt}`);
  lines.push(`bmad-fingerprint: lint_executed=${result.fingerprint.lintExecuted}`);
  lines.push(`bmad-fingerprint: file_count=${result.reviewedFiles.length}`);
  lines.push("```");
  lines.push("");
  lines.push(`## Summary`);
  lines.push(result.summary || "_(no summary)_");
  lines.push("");

  const grouped: Record<string, ReviewFinding[]> = {
    critical: [],
    major: [],
    minor: [],
    nit: [],
  };
  for (const f of result.findings) {
    (grouped[f.severity] ??= []).push(f);
  }

  for (const sev of ["critical", "major", "minor", "nit"] as const) {
    const items = grouped[sev] ?? [];
    if (items.length === 0) continue;
    lines.push(`## ${sev.charAt(0).toUpperCase()}${sev.slice(1)} Issues (${items.length})`);
    for (const item of items) {
      const where = item.file ? `\`${item.file}\`` : "(general)";
      lines.push(`- [${sev.toUpperCase()}] ${where} — ${item.description}`);
    }
    lines.push("");
  }

  if (result.reviewedFiles.length > 0) {
    lines.push(`## Files Reviewed`);
    for (const f of result.reviewedFiles) lines.push(`- \`${f}\``);
    lines.push("");
  }

  if (result.lintOutput) {
    lines.push(`## Lint Output (reference)`);
    lines.push("```");
    lines.push(result.lintOutput.slice(0, 4000));
    lines.push("```");
    lines.push("");
  }

  if (result.verdict === "blocked") {
    lines.push(`> ⛔ **BLOCKED** — This story cannot be marked done. Resolve blocking issues first.`);
  } else if (result.verdict === "changes_requested") {
    lines.push(`> ⚠️ **CHANGES REQUESTED** — Address findings before merging.`);
  } else {
    lines.push(`> ✅ **APPROVED** — Lgtm.`);
  }

  lines.push("");
  lines.push(`> 🛡️ **Audit guard:** The 4-checkpoint evidence gate requires this section to contain a \`bmad-fingerprint\` block. The audit verifies \`source\` matches an executed review path; user-edited sections are rejected.`);

  return lines.join("\n");
}
