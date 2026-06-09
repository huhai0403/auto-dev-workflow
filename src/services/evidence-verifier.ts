import { promises as fs } from "node:fs";
import path from "node:path";
import { globStoryFile } from "./batch-resolver.js";

export const EVIDENCE_CHECKS = [
  "test_output",
  "lint_output",
  "code_review_summary",
  "dod_checklist",
] as const;

export type EvidenceCheckName = (typeof EVIDENCE_CHECKS)[number];

export type SentinelKind = "test" | "lint" | "review";

export interface SectionSentinel {
  kind: SentinelKind;
  stepId: string;
  writtenAt: string;
  workflowId?: string;
}

export interface EvidenceCheckResult {
  name: EvidenceCheckName;
  required: boolean;
  passed: boolean;
  details: string;
  sentinel?: SectionSentinel;
  crossReference?: {
    stepArtifactPath: string;
    matches: boolean;
    reason?: string;
  };
}

export interface StoryEvidenceReport {
  storyKey: string;
  storyFilePath?: string;
  checks: EvidenceCheckResult[];
  passed: boolean;
  missingRequired: EvidenceCheckName[];
  requeued: boolean;
  attemptedEvidence?: {
    testOutput?: string;
    lintOutput?: string;
    codeReviewSummary?: string;
    dodChecklist?: string;
  };
}

const SENTINEL_REGEX =
  /<!--\s*bmad-evidence:(\w+)\s+step=(\S+)\s+at=(\S+?)(?:\s+workflow=(\S+?))?\s*-->/g;

export function parseSentinels(content: string): SectionSentinel[] {
  const out: SectionSentinel[] = [];
  let m: RegExpExecArray | null;
  while ((m = SENTINEL_REGEX.exec(content)) !== null) {
    const [, kindRaw, stepId, writtenAt, workflowId] = m;
    if (kindRaw === "test" || kindRaw === "lint" || kindRaw === "review") {
      out.push({
        kind: kindRaw,
        stepId,
        writtenAt,
        workflowId,
      });
    }
  }
  return out;
}

export function findSentinelForSection(
  content: string,
  headerRegex: RegExp,
  kind: SentinelKind,
): SectionSentinel | undefined {
  const lines = content.split("\n");
  let inSection = false;
  for (const line of lines) {
    if (headerRegex.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s/.test(line)) {
      inSection = false;
      continue;
    }
    if (!inSection) continue;
    const m = line.match(
      /<!--\s*bmad-evidence:(\w+)\s+step=(\S+)\s+at=(\S+?)(?:\s+workflow=(\S+?))?\s*-->/,
    );
    if (m && m[1] === kind) {
      return { kind: kind, stepId: m[2], writtenAt: m[3], workflowId: m[4] };
    }
  }
  return undefined;
}

const SECTION_HEADERS: Record<EvidenceCheckName, RegExp> = {
  test_output: /##\s*Test\s+Output|##\s*Testing|##\s*Unit\s+Tests?/i,
  lint_output: /##\s*Lint\s+Output|##\s*Lint/i,
  code_review_summary: /##\s*Code\s+Review\s+Summary|##\s*Code\s+Review|##\s*AI\s+Code\s+Review/i,
  dod_checklist: /##\s*Definition\s+of\s+Done|##\s*DoD\b/i,
};

function extractSection(content: string, header: RegExp): string | null {
  const lines = content.split("\n");
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (header.test(lines[i])) {
      startIdx = i + 1;
      break;
    }
  }
  if (startIdx < 0) return null;
  const buf: string[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    buf.push(lines[i]);
  }
  return buf.join("\n").trim();
}

function isSectionMeaningful(section: string | null): boolean {
  if (!section) return false;
  const withoutSentinels = section.replace(/<!--[\s\S]*?-->/g, "");
  const codeBlockInner = (withoutSentinels.match(/```[\s\S]*?```/g) ?? [])
    .map((b) => b.replace(/```/g, ""))
    .join("");
  const codeBlockChars = codeBlockInner.replace(/\s/g, "").length;
  const stripped = withoutSentinels
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/[#*_>|\-]/g, "")
    .replace(/\s+/g, "")
    .trim();
  return codeBlockChars + stripped.length >= 3;
}

function checkTestOutput(content: string, workflowId?: string): EvidenceCheckResult {
  const section = extractSection(content, SECTION_HEADERS.test_output);
  if (!section) {
    return {
      name: "test_output",
      required: true,
      passed: false,
      details: "No test output section found. Expected a '## Test Output' or '## Unit Tests' section with non-empty content.",
    };
  }
  if (!isSectionMeaningful(section)) {
    return {
      name: "test_output",
      required: true,
      passed: false,
      details: "Test output section exists but is empty or contains only placeholders.",
    };
  }
  if (/not\s+executed|skipped|placeholder|^\s*\(no\s+test/i.test(section)) {
    return {
      name: "test_output",
      required: true,
      passed: false,
      details: "Test output section shows 'skipped' or 'placeholder' — tests were not actually executed.",
    };
  }
  const sentinel = findSentinelForSection(content, SECTION_HEADERS.test_output, "test");
  if (!sentinel) {
    return {
      name: "test_output",
      required: true,
      passed: false,
      details:
        "Test output section is missing the '<!-- bmad-evidence:test ... -->' sentinel. The MCP step 04 (testing) must have appended this section. User-written sections are rejected.",
    };
  }
  if (workflowId && sentinel.workflowId && sentinel.workflowId !== workflowId) {
    return {
      name: "test_output",
      required: true,
      passed: false,
      details: `Test output sentinel references workflow '${sentinel.workflowId}', expected '${workflowId}'. The sentinel was copied from another workflow run.`,
      sentinel,
    };
  }
  return {
    name: "test_output",
    required: true,
    passed: true,
    details: `Test output section written by MCP step '${sentinel.stepId}' at ${sentinel.writtenAt}.`,
    sentinel,
  };
}

function checkLintOutput(content: string, workflowId?: string): EvidenceCheckResult {
  const section = extractSection(content, SECTION_HEADERS.lint_output);
  if (!section) {
    return {
      name: "lint_output",
      required: true,
      passed: false,
      details: "No lint output section found. Expected '## Lint Output' with non-empty content.",
    };
  }
  if (!isSectionMeaningful(section)) {
    return {
      name: "lint_output",
      required: true,
      passed: false,
      details: "Lint output section exists but is empty.",
    };
  }
  const sentinel = findSentinelForSection(content, SECTION_HEADERS.lint_output, "lint");
  if (!sentinel) {
    return {
      name: "lint_output",
      required: true,
      passed: false,
      details:
        "Lint output section is missing the '<!-- bmad-evidence:lint ... -->' sentinel. The MCP step 05 (code review) must have appended this section. User-written sections are rejected.",
    };
  }
  if (workflowId && sentinel.workflowId && sentinel.workflowId !== workflowId) {
    return {
      name: "lint_output",
      required: true,
      passed: false,
      details: `Lint output sentinel references workflow '${sentinel.workflowId}', expected '${workflowId}'.`,
      sentinel,
    };
  }
  return {
    name: "lint_output",
    required: true,
    passed: true,
    details: `Lint output section written by MCP step '${sentinel.stepId}' at ${sentinel.writtenAt}.`,
    sentinel,
  };
}

function checkCodeReviewSummary(content: string, workflowId?: string): EvidenceCheckResult {
  const section = extractSection(content, SECTION_HEADERS.code_review_summary);
  if (!section) {
    return {
      name: "code_review_summary",
      required: true,
      passed: false,
      details:
        "No '## Code Review Summary' or '## AI Code Review' section. Story must include a code review verdict (APPROVE / CHANGES REQUESTED / BLOCKED).",
    };
  }
  if (!isSectionMeaningful(section)) {
    return {
      name: "code_review_summary",
      required: true,
      passed: false,
      details: "Code review section exists but is empty.",
    };
  }
  if (!/(APPROVE|CHANGES\s+REQUESTED|BLOCKED|VERDICT)/i.test(section)) {
    return {
      name: "code_review_summary",
      required: true,
      passed: false,
      details: "Code review section does not include a verdict marker (APPROVE / CHANGES REQUESTED / BLOCKED).",
    };
  }
  if (/BLOCKED/i.test(section)) {
    return {
      name: "code_review_summary",
      required: true,
      passed: false,
      details: "Code review verdict is BLOCKED — story cannot be marked done.",
    };
  }
  const sentinel = findSentinelForSection(content, SECTION_HEADERS.code_review_summary, "review");
  if (!sentinel) {
    return {
      name: "code_review_summary",
      required: true,
      passed: false,
      details:
        "Code review section is missing the '<!-- bmad-evidence:review ... -->' sentinel. The MCP step 05 (code review) must have appended this section. User-written sections are rejected.",
    };
  }
  if (workflowId && sentinel.workflowId && sentinel.workflowId !== workflowId) {
    return {
      name: "code_review_summary",
      required: true,
      passed: false,
      details: `Code review sentinel references workflow '${sentinel.workflowId}', expected '${workflowId}'.`,
      sentinel,
    };
  }
  if (!/bmad-fingerprint: source=\S+/i.test(section)) {
    return {
      name: "code_review_summary",
      required: true,
      passed: false,
      details:
        "Code review section does not contain a 'bmad-fingerprint' block. Real MCP code review always emits a fingerprint with source / review_hash / reviewed_at. User-typed summaries are rejected.",
    };
  }
  const sourceMatch = section.match(/bmad-fingerprint: source=(\S+)/i);
  const source = sourceMatch?.[1];
  if (source && source !== "llm") {
    return {
      name: "code_review_summary",
      required: true,
      passed: false,
      details: `Code review fingerprint source is '${source}', not 'llm'. Stories can only be approved by an LLM review path. Run the host \`/bmad-code-review\` skill to rewrite the Code Review Summary section with a \`source=llm\` fingerprint.`,
    };
  }
  return {
    name: "code_review_summary",
    required: true,
    passed: true,
    details: `Code review summary written by MCP step '${sentinel.stepId}' at ${sentinel.writtenAt}, source=${source ?? "?"}.`,
    sentinel,
  };
}

function checkDodChecklist(content: string): EvidenceCheckResult {
  const dodSection = extractSection(content, SECTION_HEADERS.dod_checklist);
  const acSection = extractSection(content, /##\s*Acceptance\s*Criteria/i);

  const dodBoxes = dodSection?.match(/\[[ xX]\]/g) ?? [];
  const acBoxes = acSection?.match(/\[[ xX]\]/g) ?? [];

  if (dodBoxes.length === 0 && acBoxes.length === 0) {
    return {
      name: "dod_checklist",
      required: true,
      passed: false,
      details:
        "No DoD checklist found. Add a '## Definition of Done' section with `- [ ]` items, or use `- [ ]` items in your '## Acceptance Criteria' section.",
    };
  }

  if (dodBoxes.length > 0) {
    const checked = dodBoxes.filter((b) => /\[[xX]\]/.test(b));
    const unchecked = dodBoxes.length - checked.length;
    if (unchecked > 0) {
      return {
        name: "dod_checklist",
        required: true,
        passed: false,
        details: `DoD checklist incomplete: ${checked.length}/${dodBoxes.length} items checked. ${unchecked} remaining.`,
      };
    }
    return {
      name: "dod_checklist",
      required: true,
      passed: true,
      details: `All ${dodBoxes.length} DoD checklist items are checked.`,
    };
  }

  const checked = acBoxes.filter((b) => /\[[xX]\]/.test(b));
  const unchecked = acBoxes.length - checked.length;
  if (unchecked > 0) {
    return {
      name: "dod_checklist",
      required: true,
      passed: false,
      details: `Acceptance criteria checklist incomplete: ${checked.length}/${acBoxes.length} AC items checked. ${unchecked} remaining.`,
    };
  }
  return {
    name: "dod_checklist",
    required: true,
    passed: true,
    details: `All ${acBoxes.length} acceptance criteria items are checked.`,
  };
}

const CHECK_FUNCTIONS: Record<EvidenceCheckName, (c: string, w?: string) => EvidenceCheckResult> = {
  test_output: checkTestOutput,
  lint_output: checkLintOutput,
  code_review_summary: checkCodeReviewSummary,
  dod_checklist: ((c: string) => checkDodChecklist(c)) as (c: string, w?: string) => EvidenceCheckResult,
};

export function verifyStoryContent(content: string, workflowId?: string): EvidenceCheckResult[] {
  return EVIDENCE_CHECKS.map((name) => CHECK_FUNCTIONS[name](content, workflowId));
}

export function summarizeEvidence(checks: EvidenceCheckResult[]): {
  passed: boolean;
  missingRequired: EvidenceCheckName[];
} {
  const missingRequired = checks
    .filter((c) => c.required && !c.passed)
    .map((c) => c.name);
  return {
    passed: missingRequired.length === 0,
    missingRequired,
  };
}

export interface VerifyStoryOptions {
  storyKey: string;
  filePattern?: string;
  implementationArtifactsPath: string;
  overrideContent?: string;
  stepArtifactPaths?: Partial<Record<EvidenceCheckName, string>>;
  workflowId?: string;
}

export async function verifyStoryEvidence(
  options: VerifyStoryOptions,
): Promise<StoryEvidenceReport> {
  let content: string | null = null;
  let storyFilePath: string | undefined;

  if (options.overrideContent !== undefined) {
    content = options.overrideContent;
  } else {
    const pattern = options.filePattern ?? `${options.storyKey}-*`;
    storyFilePath = (await globStoryFile(options.implementationArtifactsPath, pattern)) ?? undefined;
    if (storyFilePath) {
      try {
        content = await fs.readFile(storyFilePath, "utf-8");
      } catch {
        content = null;
      }
    }
  }

  if (content === null) {
    const checks: EvidenceCheckResult[] = EVIDENCE_CHECKS.map((name) => ({
      name,
      required: true,
      passed: false,
      details: `Story file not found at ${storyFilePath ?? options.implementationArtifactsPath}. Cannot verify evidence.`,
    }));
    return {
      storyKey: options.storyKey,
      storyFilePath,
      checks,
      passed: false,
      missingRequired: [...EVIDENCE_CHECKS],
      requeued: false,
    };
  }

  const checks = verifyStoryContent(content, options.workflowId);

  if (options.stepArtifactPaths) {
    await attachCrossReferences(checks, options.stepArtifactPaths, content);
  }

  const { passed, missingRequired } = summarizeEvidence(checks);

  return {
    storyKey: options.storyKey,
    storyFilePath,
    checks,
    passed,
    missingRequired,
    requeued: false,
    attemptedEvidence: {
      testOutput: extractSection(content, SECTION_HEADERS.test_output) ?? undefined,
      lintOutput: extractSection(content, SECTION_HEADERS.lint_output) ?? undefined,
      codeReviewSummary: extractSection(content, SECTION_HEADERS.code_review_summary) ?? undefined,
      dodChecklist: extractSection(content, SECTION_HEADERS.dod_checklist) ?? undefined,
    },
  };
}

async function attachCrossReferences(
  checks: EvidenceCheckResult[],
  stepArtifactPaths: Partial<Record<EvidenceCheckName, string>>,
  storyContent: string,
): Promise<void> {
  for (const check of checks) {
    const stepPath = stepArtifactPaths[check.name];
    if (!stepPath) continue;
    let stepContent: string | null = null;
    try {
      stepContent = await fs.readFile(stepPath, "utf-8");
    } catch {
      stepContent = null;
    }
    if (stepContent === null) {
      check.passed = false;
      check.details = `${check.details} Cross-reference failed: step artifact ${stepPath} not found.`;
      check.crossReference = { stepArtifactPath: stepPath, matches: false, reason: "missing artifact" };
      continue;
    }
    const probe = buildCrossRefProbe(check.name, stepContent);
    const matches = probe !== null && storyContent.includes(probe);
    check.crossReference = {
      stepArtifactPath: stepPath,
      matches,
      reason: matches
        ? undefined
        : probe
          ? "story file does not contain the distinctive probe string from the step artifact"
          : "step artifact did not yield a comparable probe",
    };
    if (!matches && probe) {
      check.passed = false;
      check.details = `${check.details} Cross-reference failed: story file content does not match step artifact at ${path.basename(stepPath)}.`;
    }
  }
}

function buildCrossRefProbe(
  name: EvidenceCheckName,
  stepContent: string,
): string | null {
  if (name === "test_output") {
    const m = stepContent.match(/##\s*Test Output[\s\S]*?```([\s\S]*?)```/);
    if (!m) return null;
    const cleaned = m[1].trim().split("\n").slice(0, 3).join("\n").trim();
    return cleaned.length >= 8 ? cleaned : null;
  }
  if (name === "lint_output") {
    const m = stepContent.match(/##\s*Lint Output[\s\S]*?```([\s\S]*?)```/);
    if (!m) return null;
    const cleaned = m[1].trim().split("\n").slice(0, 3).join("\n").trim();
    return cleaned.length >= 8 ? cleaned : null;
  }
  if (name === "code_review_summary") {
    const hashMatch = stepContent.match(/bmad-fingerprint: review_hash=(\S+)/);
    if (hashMatch) return `bmad-fingerprint: review_hash=${hashMatch[1]}`;
    const sourceMatch = stepContent.match(/bmad-fingerprint: source=(\S+)/);
    return sourceMatch ? `bmad-fingerprint: source=${sourceMatch[1]}` : null;
  }
  return null;
}

export interface AuditBatchOptions {
  implementationArtifactsPath: string;
  stories: Array<{ key: string; filePattern?: string; title?: string }>;
  onRequeue?: (storyKey: string) => void;
}

export interface BatchAuditResult {
  reports: StoryEvidenceReport[];
  allPassed: boolean;
  failedStoryKeys: string[];
  requeuedStoryKeys: string[];
}

export async function auditBatchEvidence(
  options: AuditBatchOptions,
): Promise<BatchAuditResult> {
  const reports: StoryEvidenceReport[] = [];
  for (const s of options.stories) {
    const report = await verifyStoryEvidence({
      storyKey: s.key,
      filePattern: s.filePattern,
      implementationArtifactsPath: options.implementationArtifactsPath,
    });
    if (!report.passed) {
      report.requeued = true;
      options.onRequeue?.(s.key);
    }
    reports.push(report);
  }
  return {
    reports,
    allPassed: reports.every((r) => r.passed),
    failedStoryKeys: reports.filter((r) => !r.passed).map((r) => r.storyKey),
    requeuedStoryKeys: reports.filter((r) => r.requeued).map((r) => r.storyKey),
  };
}

export function renderAuditMarkdown(result: BatchAuditResult): string {
  const lines: string[] = [];
  lines.push(`# Completion Audit — 4-Checkpoint Evidence Gate`);
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Stories in scope | ${result.reports.length} |`);
  lines.push(`| All passed | ${result.allPassed ? "✅" : "❌"} |`);
  lines.push(`| Failed | ${result.failedStoryKeys.length} |`);
  lines.push(`| Re-queued | ${result.requeuedStoryKeys.length} |`);
  lines.push("");
  lines.push(`## Per-Story Results`);
  lines.push("");
  for (const report of result.reports) {
    const status = report.passed ? "✅ PASS" : "❌ FAIL";
    lines.push(`### ${status} — \`${report.storyKey}\``);
    if (report.storyFilePath) {
      lines.push(`File: \`${path.basename(report.storyFilePath)}\``);
    }
    lines.push("");
    lines.push(`| Check | Status | Details |`);
    lines.push(`|-------|--------|---------|`);
    for (const c of report.checks) {
      const mark = c.passed ? "✅" : "❌";
      const req = c.required ? "REQ" : "opt";
      lines.push(`| ${c.name} (${req}) | ${mark} | ${c.details.replace(/\|/g, "\\|")} |`);
    }
    lines.push("");
  }
  if (result.requeuedStoryKeys.length > 0) {
    lines.push(`## Re-queued Stories`);
    lines.push("These stories are missing required evidence and were re-queued (status reset to `in-progress`):");
    for (const k of result.requeuedStoryKeys) {
      lines.push(`- \`${k}\``);
    }
  }
  lines.push("");
  lines.push(
    `> Per BMAD ANTI-SKIP GUARDRAIL: a story is only DONE if all 4 evidence items pass. Missing any one fails the audit.`,
  );
  return lines.join("\n");
}
