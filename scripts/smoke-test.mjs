import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { workflowEngine } from "../dist/engine/workflow-engine.js";

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "bmad-mcp-test-"));

  try {
    console.log("Test project:", tmp);

    const dryRun = await workflowEngine.start({
      projectRoot: tmp,
      outputDir: ".bmad-output",
      requirementDescription: "用户登录与 JWT 鉴权模块",
      workflowType: "planning",
      mode: "dry-run",
    });
    console.log("Dry-run:", dryRun.message);
    console.log("Preview steps:", dryRun.dryRunPreview?.length);

    const run = await workflowEngine.start({
      projectRoot: tmp,
      outputDir: ".bmad-output",
      requirementDescription: "用户登录与 JWT 鉴权模块",
      workflowType: "planning",
      mode: "normal",
      includeCodegen: true,
      includeCodeReview: true,
    });
    console.log("Planning run:", run.message);
    console.log("Completed:", run.state.completedSteps.length, "steps");

    const outDir = path.join(tmp, ".bmad-output");
    const files = await fs.readdir(outDir);
    console.log("Output files:", files);

    const status = await workflowEngine.getStatus(tmp);
    console.log("Status:", status?.status, status?.progressPercent + "%");

    // Pipeline batch test
    const batchName = "v1-test-batch";
    const planningDir = path.join(outDir, "planning-artifacts", batchName);
    const implDir = path.join(outDir, "implementation-artifacts", batchName);
    await fs.mkdir(planningDir, { recursive: true });
    await fs.mkdir(implDir, { recursive: true });
    await fs.writeFile(path.join(planningDir, "prd-test.md"), "# PRD\n", "utf-8");
    await fs.writeFile(
      path.join(implDir, "sprint-status-test.md"),
      `## Development Status\n\n### Epic 1: Test\n\n| Key | Story | Status | Sprint | Priority |\n|-----|-------|--------|--------|----------|\n| 1-1 | Test story | ready-for-dev | 1 | High |\n`,
      "utf-8",
    );

    const batches = await workflowEngine.listBatches({ projectRoot: tmp, outputDir: ".bmad-output" });
    console.log("Batches:", batches.map((b) => b.name).join(", "));

    const pipeline = await workflowEngine.start({
      projectRoot: tmp,
      outputDir: ".bmad-output",
      workflowType: "pipeline",
      batch: batchName,
      mode: "normal",
    });
    console.log("Pipeline run:", pipeline.message);
    console.log("Pipeline steps:", pipeline.state.completedSteps.length);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }

  console.log("\nAll smoke tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
