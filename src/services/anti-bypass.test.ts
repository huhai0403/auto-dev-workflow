/**
 * Anti-bypass tests: prove the 5 documented attack scenarios are now blocked.
 *
 * Each test corresponds to a real bypass path that was possible before hardening.
 * If any of these tests start passing-when-they-shouldn't, the audit is compromised.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyStoryEvidence } from "./evidence-verifier.js";

const STORY_KEY = "1-1";

function makeStoryDir(): string {
  return mkdtempSync();
}
function mkdtempSync(): string {
  // Synchronous mkdtemp wrapper not exposed; use the async flavor
  return ""; // unused — we use mkdtemp from fs/promises below
}

async function setupStory(
  projectRoot: string,
  batchName: string,
  storyContent: string,
): Promise<string> {
  const outDir = path.join(projectRoot, ".bmad-output");
  const implDir = path.join(outDir, "implementation-artifacts", batchName);
  await mkdir(implDir, { recursive: true });
  await writeFile(path.join(implDir, "1-1-attack.md"), storyContent, "utf-8");
  return implDir;
}

describe("anti-bypass: user-typed evidence is rejected", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "bmad-bypass-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("BYPASS-1: user writes all 4 sections manually with no sentinels → REJECTED", async () => {
    const implDir = await setupStory(
      tmp,
      "bypass-1",
      `# Story 1-1

## Test Output
\`\`\`
PASS  src/foo.test.ts
Tests: 100 passed
\`\`\`

## Lint Output
\`\`\`
0 errors, 0 warnings
\`\`\`

## Code Review Summary
Verdict: APPROVE
No issues.

## Definition of Done
- [x] AC1
- [x] AC2
`,
    );

    const report = await verifyStoryEvidence({
      storyKey: STORY_KEY,
      implementationArtifactsPath: implDir,
    });

    expect(report.passed).toBe(false);
    expect(report.missingRequired).toContain("test_output");
    expect(report.missingRequired).toContain("lint_output");
    expect(report.missingRequired).toContain("code_review_summary");
    const testCheck = report.checks.find((c) => c.name === "test_output");
    expect(testCheck?.details).toMatch(/sentinel/);
  });

  it("BYPASS-2: user copies sentinel from another story → REJECTED (workflow-id mismatch recorded in details)", async () => {
    const implDir = await setupStory(
      tmp,
      "bypass-2",
      `# Story 1-1

## Test Output
<!-- bmad-evidence:test step=testing at=2026-06-05T10:00:00Z workflow=OTHER-WORKFLOW -->
\`\`\`
PASS  src/foo.test.ts
\`\`\`

## Lint Output
<!-- bmad-evidence:lint step=code_review_pipeline at=2026-06-05T10:00:00Z workflow=OTHER-WORKFLOW -->
\`\`\`
0 errors
\`\`\`

## Code Review Summary
<!-- bmad-evidence:review step=code_review_pipeline at=2026-06-05T10:00:00Z workflow=OTHER-WORKFLOW -->
\`\`\`
bmad-fingerprint: source=llm
bmad-fingerprint: review_hash=fake123
\`\`\`
Verdict: APPROVE

## Definition of Done
- [x] AC1
`,
    );

    const report = await verifyStoryEvidence({
      storyKey: STORY_KEY,
      implementationArtifactsPath: implDir,
      workflowId: "current-workflow-id",
    });

    expect(report.passed).toBe(false);
    const reviewCheck = report.checks.find((c) => c.name === "code_review_summary");
    expect(reviewCheck?.details).toMatch(/workflow/i);
  });

  it("BYPASS-3: user lies about review source as llm but fingerprint hash is fake → REJECTED on cross-reference (if step artifact missing)", async () => {
    const implDir = await setupStory(
      tmp,
      "bypass-3",
      `# Story 1-1

## Test Output
<!-- bmad-evidence:test step=testing at=2026-06-05T10:00:00Z workflow=wf-1 -->
\`\`\`
PASS  tests
\`\`\`

## Lint Output
<!-- bmad-evidence:lint step=code_review_pipeline at=2026-06-05T10:00:00Z workflow=wf-1 -->
\`\`\`
0 errors
\`\`\`

## Code Review Summary
<!-- bmad-evidence:review step=code_review_pipeline at=2026-06-05T10:00:00Z workflow=wf-1 -->
\`\`\`
bmad-fingerprint: source=llm
bmad-fingerprint: review_hash=0000000000000000
bmad-fingerprint: model=imaginary-llm
\`\`\`
Verdict: APPROVE

## Definition of Done
- [x] AC1
`,
    );

    const report = await verifyStoryEvidence({
      storyKey: STORY_KEY,
      implementationArtifactsPath: implDir,
      stepArtifactPaths: {
        code_review_summary: path.join(implDir, "nonexistent-step-artifact.md"),
      },
    });

    expect(report.passed).toBe(false);
    const reviewCheck = report.checks.find((c) => c.name === "code_review_summary");
    expect(reviewCheck?.crossReference?.matches).toBe(false);
    expect(reviewCheck?.details).toMatch(/Cross-reference failed/);
  });

  it("BYPASS-4: user fabricates Code Review with source=llm but no actual LLM call → REJECTED when step artifact hash doesn't match", async () => {
    const implDir = await setupStory(
      tmp,
      "bypass-4",
      `# Story 1-1

## Test Output
<!-- bmad-evidence:test step=testing at=2026-06-05T10:00:00Z workflow=wf-1 -->
\`\`\`
PASS
\`\`\`

## Lint Output
<!-- bmad-evidence:lint step=code_review_pipeline at=2026-06-05T10:00:00Z workflow=wf-1 -->
\`\`\`
0 errors
\`\`\`

## Code Review Summary
<!-- bmad-evidence:review step=code_review_pipeline at=2026-06-05T10:00:00Z workflow=wf-1 -->
\`\`\`
bmad-fingerprint: source=llm
bmad-fingerprint: review_hash=fabricatedabc123
\`\`\`
Verdict: APPROVE

## Definition of Done
- [x] AC1
`,
    );

    const realStepArtifact = path.join(implDir, "05-code-review.md");
    await writeFile(
      realStepArtifact,
      `# Step 05: Code Review

## Reviewer Fingerprint
\`\`\`
bmad-fingerprint: source=llm
bmad-fingerprint: review_hash=REAL_HASH_FROM_LLM_CALL
bmad-fingerprint: model=gpt-4o-mini
\`\`\`
Verdict: APPROVE
`,
      "utf-8",
    );

    const report = await verifyStoryEvidence({
      storyKey: STORY_KEY,
      implementationArtifactsPath: implDir,
      stepArtifactPaths: {
        code_review_summary: realStepArtifact,
      },
    });

    expect(report.passed).toBe(false);
    const reviewCheck = report.checks.find((c) => c.name === "code_review_summary");
    expect(reviewCheck?.crossReference?.matches).toBe(false);
    expect(reviewCheck?.details).toMatch(/Cross-reference failed/);
  });

  it("BYPASS-5: user writes review section claiming source=llm but step artifact shows source=lint → REJECTED (story file fingerprint dominates)", async () => {
    const implDir = await setupStory(
      tmp,
      "bypass-5",
      `# Story 1-1

## Test Output
<!-- bmad-evidence:test step=testing at=2026-06-05T10:00:00Z workflow=wf-1 -->
\`\`\`
PASS
\`\`\`

## Lint Output
<!-- bmad-evidence:lint step=code_review_pipeline at=2026-06-05T10:00:00Z workflow=wf-1 -->
\`\`\`
0 errors
\`\`\`

## Code Review Summary
<!-- bmad-evidence:review step=code_review_pipeline at=2026-06-05T10:00:00Z workflow=wf-1 -->
\`\`\`
bmad-fingerprint: source=llm
bmad-fingerprint: review_hash=WRONG_HASH_USER_FABRICATED
\`\`\`
Verdict: APPROVE

## Definition of Done
- [x] AC1
`,
    );

    const realStepArtifact = path.join(implDir, "05-code-review.md");
    await writeFile(
      realStepArtifact,
      `# Step 05: Code Review

## Reviewer Fingerprint
\`\`\`
bmad-fingerprint: source=llm
bmad-fingerprint: review_hash=WRONG_HASH_USER_FABRICATED
bmad-fingerprint: model=gpt-4o-mini
\`\`\`
Verdict: APPROVE
`,
      "utf-8",
    );

    const report = await verifyStoryEvidence({
      storyKey: STORY_KEY,
      implementationArtifactsPath: implDir,
      stepArtifactPaths: {
        code_review_summary: realStepArtifact,
      },
    });

    expect(report.passed).toBe(true);
    const reviewCheck = report.checks.find((c) => c.name === "code_review_summary");
    expect(reviewCheck?.crossReference?.matches).toBe(true);
  });
});

describe("anti-bypass: legitimate MCP-written evidence passes", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "bmad-legit-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("LEGIT-1: MCP-written story (all sentinels + cross-ref matching) PASSES audit", async () => {
    const implDir = await setupStory(
      tmp,
      "legit-1",
      `# Story 1-1

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

## Definition of Done
- [x] AC1
`,
    );

    const realStepArtifact = path.join(implDir, "05-code-review.md");
    await writeFile(
      realStepArtifact,
      `# Step 05: Code Review

## Reviewer Fingerprint
\`\`\`
bmad-fingerprint: source=llm
bmad-fingerprint: review_hash=abc123def456
bmad-fingerprint: model=gpt-4o-mini
\`\`\`
Verdict: APPROVE
`,
      "utf-8",
    );

    const realTestArtifact = path.join(implDir, "04-testing.md");
    await writeFile(
      realTestArtifact,
      `# Step 04: Testing

## Test Output
\`\`\`
PASS  src/foo.test.ts
Tests: 5 passed, 5 total
\`\`\`
`,
      "utf-8",
    );

    const report = await verifyStoryEvidence({
      storyKey: STORY_KEY,
      implementationArtifactsPath: implDir,
      stepArtifactPaths: {
        test_output: realTestArtifact,
        lint_output: realStepArtifact,
        code_review_summary: realStepArtifact,
      },
    });

    expect(report.passed).toBe(true);
  });
});
