import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getOutputFile } from "../constants.js";
import { writeArtifact } from "../engine/state-store.js";
import type { StepContext, StepResult, WorkflowStepId } from "../types.js";

const execFileAsync = promisify(execFile);

export async function writeStepFile(
  ctx: StepContext,
  stepId: WorkflowStepId,
  content: string,
  basePath?: string,
): Promise<StepResult> {
  const relative = getOutputFile(ctx.state.workflowType, stepId);
  if (!relative) {
    return { success: false, outputFiles: [], outputSummary: "Unknown step output", error: "No output file" };
  }

  const artifactBase = basePath ?? ctx.state.outputDir;
  const fullPath = await writeArtifact(ctx.state, relative, content, ctx.dryRun, artifactBase);
  return {
    success: true,
    outputFiles: [fullPath],
    outputSummary: `Wrote ${relative} (${content.length} chars)`,
    content,
  };
}

export async function tryRunScript(
  projectRoot: string,
  scriptName: string,
): Promise<string | undefined> {
  try {
    const fs = await import("node:fs/promises");
    const pkgRaw = await fs.readFile(`${projectRoot}/package.json`, "utf-8");
    const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
    if (!pkg.scripts?.[scriptName]) {
      return undefined;
    }
    const { stdout, stderr } = await execFileAsync("npm", ["run", scriptName], {
      cwd: projectRoot,
      timeout: 180_000,
      shell: process.platform === "win32",
    });
    return [stdout, stderr].filter(Boolean).join("\n").slice(0, 8000);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `${scriptName} failed or unavailable: ${message}`.slice(0, 4000);
  }
}

export async function tryRunLint(projectRoot: string): Promise<string | undefined> {
  return tryRunScript(projectRoot, "lint");
}

export async function tryRunUnitTests(projectRoot: string): Promise<string | undefined> {
  return tryRunScript(projectRoot, "test:unit");
}
