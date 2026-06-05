import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { llmProvider } from "./llm-provider.js";

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
  useLlm: boolean;
  storyKey?: string;
  storyTitle?: string;
  storyFilePath?: string;
  changedFiles?: string[];
  lintOutput?: string;
  maxFiles?: number;
  maxFileSizeBytes?: number;
}

const REVIEW_SYSTEM_PROMPT = `You are a senior staff engineer performing a thorough adversarial code review.

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
- "blocked" = unfixable without more context or design decisions`;

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

export async function readChangedFiles(
  projectRoot: string,
  files: string[],
  maxFileSizeBytes = 60_000,
): Promise<Array<{ path: string; content: string }>> {
  const out: Array<{ path: string; content: string }> = [];
  for (const rel of files) {
    const abs = path.resolve(projectRoot, rel);
    if (!abs.startsWith(path.resolve(projectRoot))) continue;
    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) continue;
      if (stat.size > maxFileSizeBytes) {
        out.push({
          path: rel,
          content: `// [TRUNCATED — file size ${stat.size} > ${maxFileSizeBytes} bytes]`,
        });
        continue;
      }
      const content = await fs.readFile(abs, "utf-8");
      out.push({ path: rel, content });
    } catch {
      // skip unreadable
    }
  }
  return out;
}

function parseVerdict(text: string): ReviewVerdict {
  const match = text.match(/VERDICT:\s*(approve|changes_requested|blocked)/i);
  if (match) {
    const v = match[1].toLowerCase();
    if (v === "approve" || v === "blocked") return v;
    if (v === "changes_requested") return "changes_requested";
  }
  return "changes_requested";
}

function parseFindings(text: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const m = line.match(/^\s*-\s*\[(CRITICAL|MAJOR|MINOR|NIT)\]\s*([^:]+?):\s*(.+)$/);
    if (m) {
      const [, sevRaw, fileRaw, descRaw] = m;
      const sev = sevRaw.toLowerCase() as ReviewFinding["severity"];
      const file = fileRaw.trim();
      const colon = file.indexOf("(");
      const cleanFile = colon > 0 ? file.slice(0, colon).trim() : file;
      findings.push({
        severity: sev,
        file: cleanFile,
        description: descRaw.trim(),
      });
    }
  }
  return findings;
}

function extractSummary(text: string): string {
  const m = text.match(/##\s*Summary([\s\S]*?)(?=##\s|$)/i);
  return m ? m[1].trim() : text.split("\n").slice(0, 5).join("\n").trim();
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
    verdict: hasError ? "changes_requested" : "changes_requested",
    summary: `Lint-only review — AI review NOT performed. ${findings.length} lint finding(s). Verdict CANNOT be APPROVE because no LLM review was executed. To get an APPROVE, run with use_llm=true and OPENAI_API_KEY set.`,
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
    summary: `${opts.reason} Verdict is CHANGES_REQUESTED, not APPROVE — story cannot be marked done until a real review is performed.`,
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

  const files = await readChangedFiles(
    options.projectRoot,
    changedFiles,
    maxFileSizeBytes,
  );

  if (!options.useLlm) {
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
        "use_llm=false. Pass use_llm=true and set OPENAI_API_KEY to enable AI review.",
      source: "llm_disabled",
      lintOutput,
      lintExecuted,
    });
  }

  if (!llmProvider.isAvailable()) {
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
        "OPENAI_API_KEY (or LLM_API_KEY) is not set. Cannot perform AI review without credentials.",
      source: "llm_error",
      lintOutput,
      lintExecuted,
    });
  }

  const fileBlocks = files
    .map((f) => `### \`${f.path}\`\n\`\`\`\n${f.content}\n\`\`\``)
    .join("\n\n");

  const userPrompt = [
    options.storyKey
      ? `Story: ${options.storyKey}${options.storyTitle ? ` — ${options.storyTitle}` : ""}`
      : "",
    `Project root: ${options.projectRoot}`,
    `Files under review (${files.length}):`,
    fileBlocks,
    lintOutput ? `\n## Lint Output (informational)\n\`\`\`\n${lintOutput.slice(0, 4000)}\n\`\`\`` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await llmProvider.generate({
    systemPrompt: REVIEW_SYSTEM_PROMPT,
    userPrompt,
    fallback: "",
  });

  if (!raw) {
    return renderFallbackReview({
      reviewedFiles: changedFiles,
      reason: "LLM returned empty content after a successful API call.",
      source: "llm_error",
      lintOutput,
      lintExecuted,
    });
  }

  const verdict = parseVerdict(raw);
  const findings = parseFindings(raw);
  const summary = extractSummary(raw);

  const fingerprint = makeFingerprint("llm", raw, changedFiles, lintExecuted);
  return {
    verdict,
    summary,
    findings,
    reviewedFiles: changedFiles,
    reviewSource: "llm",
    rawOutput: raw,
    lintOutput,
    fingerprint: { ...fingerprint, model: process.env.OPENAI_MODEL ?? process.env.LLM_MODEL ?? "gpt-4o-mini" },
  };
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
