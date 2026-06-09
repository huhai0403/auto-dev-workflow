import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, access, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { workflowEngine } from "./workflow-engine.js";
import { verifyStoryEvidence } from "../services/evidence-verifier.js";

const buildCompleteStory = (workflowId: string): string => `# Story 1-1: Test story

## Acceptance Criteria
### AC-1
Given x, when y, then z.

## Test Output
<!-- bmad-evidence:test step=testing at=2026-06-05T10:00:00Z workflow=${workflowId} -->
\`\`\`
PASS  src/foo.test.ts
Tests: 3 passed, 3 total
\`\`\`

## Lint Output
<!-- bmad-evidence:lint step=code_review_pipeline at=2026-06-05T10:00:01Z workflow=${workflowId} -->
\`\`\`
0 errors, 0 warnings
\`\`\`

## Code Review Summary
<!-- bmad-evidence:review step=code_review_pipeline at=2026-06-05T10:00:02Z workflow=${workflowId} -->
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

const buildIncompleteStory = (workflowId: string): string => `# Story 1-2: Incomplete

## Test Output
<!-- bmad-evidence:test step=testing at=2026-06-05T10:00:00Z workflow=${workflowId} -->
\`\`\`
Skipped (no test:unit script)
\`\`\`
`;

async function setupBatch(projectRoot: string, batchName: string, stories: Array<{ key: string; fileName: string; content: string }>) {
  const outDir = path.join(projectRoot, ".bmad-output");
  const planningDir = path.join(outDir, "planning-artifacts", batchName);
  const implDir = path.join(outDir, "implementation-artifacts", batchName);
  await mkdir(planningDir, { recursive: true });
  await mkdir(implDir, { recursive: true });
  await writeFile(path.join(planningDir, "prd-test.md"), "# PRD\n", "utf-8");
  const lines = [
    "## Development Status",
    "",
    "### Epic 1: Test",
    "",
    "| Key | Story | Status | Sprint | Priority |",
    "|-----|-------|--------|--------|----------|",
  ];
  for (const s of stories) {
    lines.push(`| ${s.key} | ${s.key} | ready-for-dev | 1 | High |`);
  }
  await writeFile(
    path.join(implDir, "sprint-status-test.md"),
    lines.join("\n") + "\n",
    "utf-8",
  );
  for (const s of stories) {
    await writeFile(path.join(implDir, s.fileName), s.content, "utf-8");
  }
  return implDir;
}

describe("integration: pipeline with 4-checkpoint audit", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "bmad-int-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("verifies evidence directly using the verifier", async () => {
    const batchName = "v1-int-direct";
    const workflowId = "bmad-20260605-direct";
    const implDir = await setupBatch(tmp, batchName, [
      { key: "1-1", fileName: "1-1-test-story.md", content: buildCompleteStory(workflowId) },
    ]);
    const files = await readdir(implDir);
    console.log("Files in impl dir:", files);
    const report = await verifyStoryEvidence({
      storyKey: "1-1",
      filePattern: "1-1-*",
      implementationArtifactsPath: implDir,
      workflowId,
    });
    console.log("Direct verify report:", JSON.stringify(report, null, 2));
    expect(report.passed).toBe(true);
  });

  it("completes pipeline and writes 4-checkpoint audit report", async () => {
    const batchName = "v1-int-test";

    await setupBatchMetadataOnly(tmp, batchName, [
      { key: "1-1" },
      { key: "1-2" },
    ]);

    await writeFile(
      path.join(tmp, ".bmad-output", "implementation-artifacts", batchName, "1-2-incomplete.md"),
      buildIncompleteStory("placeholder"),
      "utf-8",
    );

    const result = await workflowEngine.start({
      projectRoot: tmp,
      outputDir: ".bmad-output",
      workflowType: "pipeline",
      batch: batchName,
      mode: "normal",
    });

    expect(result.state.status).toBe("failed");
    expect(result.state.lastError).toMatch(/Completion audit failed/);
    expect(result.state.lastError).toContain("1-2");

    const batch = result.state.batchContext!;
    const story2 = batch.selectedStories.find((s) => s.key === "1-2");
    expect(story2?.status).toBe("in-progress");

    const auditPath = path.join(
      batch.implementationArtifactsPath,
      "mcp-workflow-run",
      "08-completion-audit.md",
    );
    await access(auditPath);
    const auditContent = await readFile(auditPath, "utf-8");
    expect(auditContent).toContain("4-Checkpoint Evidence Gate Results");
    expect(auditContent).toContain("Re-queued Stories");
    expect(auditContent).toContain("1-2");
  });

  it("requeues story when MCP code review cannot produce an LLM fingerprint (host skill required)", async () => {
    const batchName = "v1-int-pass";

    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    await writeFile(path.join(tmp, "README.md"), "# Test\n", "utf-8");
    await execFileAsync("git", ["init", "--initial-branch=main"], { cwd: tmp });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: tmp });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: tmp });
    await writeFile(path.join(tmp, "src.ts"), "export const x = 1;\n", "utf-8");
    await execFileAsync("git", ["add", "."], { cwd: tmp });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: tmp });
    await writeFile(path.join(tmp, "src.ts"), "export const x = 2;\n", "utf-8");
    void execFile;

    await setupBatchMetadataOnly(tmp, batchName, [{ key: "1-1" }]);

    const implDir = path.join(tmp, ".bmad-output", "implementation-artifacts", batchName);
    await writeFile(
      path.join(implDir, "1-1-test-story.md"),
      `# Story 1-1: Test story

## Definition of Done
- [x] AC1 implemented
- [x] AC2 implemented
- [x] Tests pass
`,
      "utf-8",
    );

    const result = await workflowEngine.start({
      projectRoot: tmp,
      outputDir: ".bmad-output",
      workflowType: "pipeline",
      batch: batchName,
      mode: "normal",
    });

    expect(result.state.status).toBe("failed");
    expect(result.state.lastError ?? "").toMatch(/Completion audit failed/i);

    const auditPath = path.join(
      result.state.batchContext!.implementationArtifactsPath,
      "mcp-workflow-run",
      "08-completion-audit.md",
    );
    const auditContent = await readFile(auditPath, "utf-8");
    expect(auditContent).toContain("4-Checkpoint Evidence Gate Results");
    expect(auditContent).toContain("Re-queued Stories");
    expect(auditContent).toContain("1-1");
    expect(auditContent).toMatch(/source is 'lint', not 'llm'/);
  });
});

async function setupBatchMetadataOnly(
  projectRoot: string,
  batchName: string,
  stories: Array<{ key: string }>,
): Promise<void> {
  const outDir = path.join(projectRoot, ".bmad-output");
  const planningDir = path.join(outDir, "planning-artifacts", batchName);
  const implDir = path.join(outDir, "implementation-artifacts", batchName);
  await mkdir(planningDir, { recursive: true });
  await mkdir(implDir, { recursive: true });
  await writeFile(path.join(planningDir, "prd-test.md"), "# PRD\n", "utf-8");
  const lines = [
    "## Development Status",
    "",
    "### Epic 1: Test",
    "",
    "| Key | Story | Status | Sprint | Priority |",
    "|-----|-------|--------|--------|----------|",
  ];
  for (const s of stories) {
    lines.push(`| ${s.key} | ${s.key} | ready-for-dev | 1 | High |`);
  }
  await writeFile(
    path.join(implDir, "sprint-status-test.md"),
    lines.join("\n") + "\n",
    "utf-8",
  );
}
