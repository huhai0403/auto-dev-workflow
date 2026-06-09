import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { workflowEngine } from "./workflow-engine.js";

async function setupBatchDir(
  projectRoot: string,
  batchName: string,
  stories: Array<{ key: string; completed: boolean }>,
): Promise<{ implDir: string; storyFiles: string[] }> {
  const outDir = path.join(projectRoot, ".bmad-output");
  const planningDir = path.join(outDir, "planning-artifacts", batchName);
  const implDir = path.join(outDir, "implementation-artifacts", batchName);
  await mkdir(planningDir, { recursive: true });
  await mkdir(implDir, { recursive: true });
  await writeFile(path.join(planningDir, "prd.md"), "# PRD test", "utf-8");
  await writeFile(path.join(planningDir, "epics.md"), "# Epics", "utf-8");

  const sprintLines = [
    "## Development Status",
    "",
    "### Epic 1: Test",
    "",
    "| Key | Story | Status | Sprint | Priority |",
    "|-----|-------|--------|--------|----------|",
  ];
  for (const s of stories) {
    sprintLines.push(`| ${s.key} | ${s.key} | ${s.completed ? "done" : "ready-for-dev"} | 1 | High |`);
  }
  await writeFile(path.join(implDir, "sprint-status.md"), sprintLines.join("\n") + "\n", "utf-8");

  const storyFiles: string[] = [];
  for (const s of stories) {
    const fname = `${s.key}-test-story.md`;
    const content = s.completed
      ? `# Story ${s.key}

## Acceptance Criteria
### AC-1
Given x, when y, then z.

## Test Output
<!-- bmad-evidence:test step=testing at=2026-06-09T10:00:00Z workflow=test-wf -->
\`\`\`
PASS  tests for ${s.key}
\`\`\`

## Lint Output
<!-- bmad-evidence:lint step=code_review_pipeline at=2026-06-09T10:00:01Z workflow=test-wf -->
\`\`\`
0 errors
\`\`\`

## Code Review Summary
<!-- bmad-evidence:review step=code_review_pipeline at=2026-06-09T10:00:02Z workflow=test-wf -->
\`\`\`
bmad-fingerprint: source=llm
bmad-fingerprint: review_hash=hash${s.key}
bmad-fingerprint: model=gpt-4o-mini
bmad-fingerprint: reviewed_at=2026-06-09T10:00:02Z
bmad-fingerprint: lint_executed=true
bmad-fingerprint: file_count=1
\`\`\`
Verdict: APPROVE

## Definition of Done
- [x] AC1
- [x] tests pass
`
      : `# Story ${s.key}\n\n## Test Output\n<!-- bmad-evidence:test step=testing at=2026-06-09T10:00:00Z workflow=test-wf -->\n\`\`\`\npartial\n\`\`\`\n`;
    const fp = path.join(implDir, fname);
    await writeFile(fp, content, "utf-8");
    storyFiles.push(fp);
  }
  return { implDir, storyFiles };
}

describe("chain_to_pipeline", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "bmad-chain-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("chain_to_pipeline=false: only runs planning", async () => {
    const result = await workflowEngine.start({
      projectRoot: tmp,
      outputDir: ".bmad-output",
      requirementDescription: "Build a TODO list web app",
      workflowType: "planning",
      mode: "normal",
      chainToPipeline: false,
    });
    expect(result.state.workflowType).toBe("planning");
    expect(result.state.status).toBe("completed");
    expect(result.state.chainPhases?.length ?? 0).toBe(1);
    expect(result.chainSummaryPath).toBeUndefined();
  });

  it("chain_to_pipeline=true with no pre-existing batch: planning writes its own batch dir, chain runs pipeline with empty story list", async () => {
    const result = await workflowEngine.start({
      projectRoot: tmp,
      outputDir: ".bmad-output",
      requirementDescription: "Empty chain test",
      workflowType: "planning",
      mode: "normal",
      chainToPipeline: true,
    });
    expect(result.state.workflowType).toBe("pipeline");
    expect(result.state.status).toBe("completed");
    expect(result.message).toMatch(/\[chain\]/);
    expect(result.chainSummaryPath).toBeDefined();
    expect(result.state.chainPhases?.length).toBe(2);
  });

  it("chain_to_pipeline=true with batch: chain runs both phases (planning completed, pipeline reaches completion_audit)", async () => {
    const requirementDescription = "Full chain test";
    const batchName = "full-chain-test";
    await setupBatchDir(tmp, batchName, [{ key: "1-1", completed: true }]);

    const result = await workflowEngine.start({
      projectRoot: tmp,
      outputDir: ".bmad-output",
      requirementDescription,
      workflowType: "planning",
      mode: "normal",
      chainToPipeline: true,
    });

    expect(result.state.chainPhases?.length).toBe(2);
    expect(result.state.chainPhases?.[0].workflowType).toBe("planning");
    expect(result.state.chainPhases?.[1].workflowType).toBe("pipeline");

    const plan = result.state.chainPhases![0];
    const pipe = result.state.chainPhases![1];
    expect(plan.status).toBe("completed");
    expect(plan.completedSteps.length).toBe(8);

    expect(pipe.completedSteps.length).toBeGreaterThanOrEqual(7);
    expect(pipe.completedSteps).toContain("story_discovery");
    expect(pipe.completedSteps).toContain("create_story");
    expect(pipe.completedSteps).toContain("development");
    expect(pipe.completedSteps).toContain("testing");
    expect(pipe.completedSteps).toContain("code_review_pipeline");
    expect(pipe.completedSteps).toContain("status_update");
    expect(pipe.completedSteps).toContain("checkpoint");

    expect(plan.auditLog.every((e) => e.phase === "planning")).toBe(true);
    expect(pipe.auditLog.every((e) => e.phase === "pipeline")).toBe(true);

    expect(result.message).toMatch(/\[chain\]/);
    expect(result.message).toMatch(/Planning.*completed/);
    expect(result.chainSummaryPath).toBeDefined();

    await access(result.chainSummaryPath!);
    const summaryContent = await readFile(result.chainSummaryPath!, "utf-8");
    expect(summaryContent).toContain("Chain Workflow Summary");
    expect(summaryContent).toContain("Planning phase");
    expect(summaryContent).toContain("Pipeline phase");
    expect(summaryContent).toContain(batchName);
  });

  it("chain: state.json contains both phases in chainPhases", async () => {
    const requirementDescription = "State inspection test";
    const batchName = "state-inspection-test";
    await setupBatchDir(tmp, batchName, [{ key: "1-1", completed: true }]);

    const result = await workflowEngine.start({
      projectRoot: tmp,
      outputDir: ".bmad-output",
      requirementDescription,
      workflowType: "planning",
      mode: "normal",
      chainToPipeline: true,
    });

    const statePath = path.join(tmp, ".bmad-workflow-state.json");
    const stateContent = await readFile(statePath, "utf-8");
    const parsed = JSON.parse(stateContent);
    expect(parsed.chainPhases).toBeDefined();
    expect(parsed.chainPhases.length).toBe(2);
    expect(parsed.currentChainPhase).toBe(1);
    expect(parsed.workflowId).toBe(result.state.workflowId);
  });

  it("chain: pipeline phase 4-checkpoint failure is recorded in phase[1], not blocking planning phase completion", async () => {
    const requirementDescription = "Pipeline-fail test";
    const batchName = "pipeline-fail-test";
    await setupBatchDir(tmp, batchName, [{ key: "1-1", completed: true }]);

    const result = await workflowEngine.start({
      projectRoot: tmp,
      outputDir: ".bmad-output",
      requirementDescription,
      workflowType: "planning",
      mode: "normal",
      chainToPipeline: true,
    });

    const plan = result.state.chainPhases![0];
    const pipe = result.state.chainPhases![1];

    expect(plan.status).toBe("completed");
    expect(pipe.status).toBe("failed");
    expect(pipe.lastError).toMatch(/Completion audit failed/);

    const failedAudit = pipe.auditLog.find((e) => e.step === "completion_audit");
    expect(failedAudit).toBeDefined();
    expect(failedAudit!.success).toBe(false);
  });
});

describe("chain: legacy state migration", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "bmad-migrate-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("old-schema state.json (no chainPhases) is auto-migrated on load", async () => {
    const legacy = {
      workflowId: "bmad-20260101-legacy01",
      workflowType: "planning",
      projectRoot: tmp,
      outputDir: path.join(tmp, ".bmad-output"),
      requirementDescription: "legacy",
      mode: "normal",
      status: "failed",
      currentStep: "user_stories",
      completedSteps: ["discovery"],
      skippedSteps: [],
      includeCodegen: true,
      includeCodeReview: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      cancelRequested: false,
      auditLog: [],
      artifacts: {},
    };
    await writeFile(path.join(tmp, ".bmad-workflow-state.json"), JSON.stringify(legacy), "utf-8");

    const status = await workflowEngine.getStatus(tmp);
    expect(status).not.toBeNull();
    expect(status!.workflowId).toBe("bmad-20260101-legacy01");
  });
});
