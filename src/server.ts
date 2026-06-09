import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getStepLabel, SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { workflowEngine } from "./engine/workflow-engine.js";
import type { WorkflowRunResult } from "./types.js";

const CHAIN_MAX_SUMMARY_LINES = 200;
const CHAIN_PREVIEW_LINES = 30;

function formatRunResult(result: WorkflowRunResult): string {
  const { state } = result;
  const lines: string[] = [
    result.message,
    "",
    `Workflow ID: ${state.workflowId}`,
    `Type: ${state.workflowType}`,
    `Status: ${state.status}`,
    `Output: ${state.outputDir}`,
    state.batch ? `Batch: ${state.batch}` : "",
  ];

  if (state.chainPhases && state.chainPhases.length > 1) {
    lines.push(`Chain phases: ${state.chainPhases.length}`);
    for (let i = 0; i < state.chainPhases.length; i++) {
      const ph = state.chainPhases[i];
      lines.push(
        `  [${i}] ${ph.workflowType} - ${ph.status} - ${ph.completedSteps.length} done, ${ph.skippedSteps.length} skipped`,
      );
    }
    lines.push(
      `Completed: ${state.completedSteps.map((s) => getStepLabel(state.workflowType, s)).join(", ") || "(none)"}`,
    );
  } else {
    lines.push(
      `Completed steps: ${state.completedSteps.map((s) => getStepLabel(state.workflowType, s)).join(", ") || "(none)"}`,
    );
  }

  if (state.skippedSteps.length) {
    lines.push(
      `Skipped: ${state.skippedSteps.map((s) => getStepLabel(state.workflowType, s)).join(", ")}`,
    );
  }

  if (result.dryRunPreview?.length) {
    lines.push("", "## Dry-run preview");
    for (const item of result.dryRunPreview) {
      lines.push(`- ${item.stepLabel}: ${item.outputPath}${item.skipped ? " (skip)" : ""}`);
    }
  }

  if (state.lastError) {
    lines.push("", `Last error: ${state.lastError}`);
  }

  if (result.chainSummaryPath) {
    lines.push("", `Chain summary (full): ${result.chainSummaryPath}`);
  }

  const full = lines.join("\n");
  if (lines.length > CHAIN_MAX_SUMMARY_LINES) {
    const preview = lines.slice(0, CHAIN_PREVIEW_LINES).join("\n");
    return `${preview}\n\n... (truncated to ${CHAIN_PREVIEW_LINES}/${lines.length} lines; chain summary at ${result.chainSummaryPath ?? state.outputDir})`;
  }
  return full;
}

const SERVER_START_CWD = process.cwd();

const RECOMMENDED_PRESETS = `Recommended presets (pick one, present to the user as a choice):

1) Planning — greenfield new project
   workflow_type=planning, output_dir=.bmad-output, requirement_description=<text>,
   chain_to_pipeline=true (default)

2) Planning dry-run — preview artifacts, no files written
   workflow_type=planning, mode=dry-run, output_dir=.bmad-output,
   requirement_description=<text>, include_codegen=false

3) Pipeline — continue an existing batch
   workflow_type=pipeline, output_dir=.bmad-output, batch=<name>,
   epic=<n> (optional), story=<n>-<m> (optional, e.g. "1-3")

4) List batches
   list_bmad_batches(project_root, output_dir)

project_root is OPTIONAL. When omitted, it defaults to the MCP server's startup working directory
(currently: ${SERVER_START_CWD}). Override only if the target project lives elsewhere.`;

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  server.registerTool(
    "start_bmad_workflow",
    {
      title: "Start BMAD Workflow",
      description: `Start a BMAD workflow.

workflow_type=planning: PRD → stories → AC → architecture → tasks → codegen → review → audit
workflow_type=pipeline: Story discovery → dev → test → review → status → checkpoint → audit (requires batch artifacts)

output_dir is REQUIRED (e.g. '.bmad-output' or '_bmad-output').
project_root is OPTIONAL; defaults to the MCP server's startup working directory (${SERVER_START_CWD}).

${RECOMMENDED_PRESETS}

chain_to_pipeline (default true): when workflow_type=planning and this is set, after the planning
phase finishes successfully, the engine automatically runs the pipeline phase on the inferred batch
IN THE SAME tool call. The host does not need to issue a second tool call. Set to false to keep v0.2.x
behavior (two separate calls).`,
      inputSchema: {
        project_root: z
          .string()
          .optional()
          .describe(
            `Project root path. Optional — defaults to the MCP server's startup working directory (${SERVER_START_CWD}).`,
          ),
        output_dir: z.string().describe("Artifacts root relative to project_root (required)"),
        requirement_description: z
          .string()
          .optional()
          .describe("Required for planning workflow; optional for pipeline if batch exists"),
        workflow_type: z
          .enum(["planning", "pipeline"])
          .default("planning")
          .describe("Planning (greenfield) or pipeline (existing batch)"),
        mode: z.enum(["normal", "dry-run"]).default("normal"),
        include_codegen: z.boolean().default(true),
        include_code_review: z.boolean().default(true),
        batch: z.string().optional().describe("Batch name for pipeline workflow"),
        epic: z.string().optional().describe("Filter by epic number (e.g. '1')"),
        story: z.string().optional().describe("Filter by story key (e.g. '1-3')"),
        chain_to_pipeline: z
          .boolean()
          .default(true)
          .describe(
            "(planning only) Automatically run the pipeline phase on the inferred batch in the same tool call. Set false to disable chain.",
          ),
      },
    },
    async (args) => {
      try {
        const projectRoot = args.project_root?.trim() || SERVER_START_CWD;
        const result = await workflowEngine.start({
          projectRoot,
          outputDir: args.output_dir,
          requirementDescription: args.requirement_description,
          workflowType: args.workflow_type,
          mode: args.mode,
          includeCodegen: args.include_codegen,
          includeCodeReview: args.include_code_review,
          batch: args.batch,
          epic: args.epic,
          story: args.story,
          chainToPipeline: args.chain_to_pipeline,
        });

        return {
          content: [{ type: "text", text: formatRunResult(result) }],
          structuredContent: {
            workflowId: result.state.workflowId,
            workflowType: result.state.workflowType,
            status: result.state.status,
            outputDir: result.state.outputDir,
            batch: result.state.batch,
            completedSteps: result.state.completedSteps,
            chainPhases: result.state.chainPhases?.map((p) => ({
              workflowType: p.workflowType,
              status: p.status,
              completedSteps: p.completedSteps,
            })),
            dryRunPreview: result.dryRunPreview,
            chainSummaryPath: result.chainSummaryPath,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "resume_bmad_workflow",
    {
      title: "Resume BMAD Workflow",
      description: `Resume from .bmad-workflow-state.json. project_root is OPTIONAL; defaults to the MCP server's startup working directory (${SERVER_START_CWD}).`,
      inputSchema: {
        project_root: z
          .string()
          .optional()
          .describe(
            `Project root path. Optional — defaults to the MCP server's startup working directory (${SERVER_START_CWD}).`,
          ),
      },
    },
    async (args) => {
      try {
        const projectRoot = args.project_root?.trim() || SERVER_START_CWD;
        const result = await workflowEngine.resume(projectRoot);
        return {
          content: [{ type: "text", text: formatRunResult(result) }],
          structuredContent: {
            workflowId: result.state.workflowId,
            status: result.state.status,
            completedSteps: result.state.completedSteps,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_workflow_status",
    {
      title: "Get Workflow Status",
      description: `Query workflow progress. project_root is OPTIONAL; defaults to the MCP server's startup working directory (${SERVER_START_CWD}).`,
      inputSchema: {
        project_root: z
          .string()
          .optional()
          .describe(
            `Project root path. Optional — defaults to the MCP server's startup working directory (${SERVER_START_CWD}).`,
          ),
      },
    },
    async (args) => {
      try {
        const projectRoot = args.project_root?.trim() || SERVER_START_CWD;
        const status = await workflowEngine.getStatus(projectRoot);
        if (!status) {
          return { content: [{ type: "text", text: "No workflow state found." }] };
        }

        const text = [
          `Workflow ID: ${status.workflowId}`,
          `Type: ${status.workflowType}`,
          `Status: ${status.status}`,
          `Progress: ${status.progressPercent}%`,
          `Batch: ${status.batch ?? "n/a"}`,
          `Current step: ${status.currentStep ?? "(none)"}`,
          `Output: ${status.outputDir}`,
          status.lastError ? `Last error: ${status.lastError}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        return {
          content: [{ type: "text", text }],
          structuredContent: status as unknown as Record<string, unknown>,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "cancel_workflow",
    {
      title: "Cancel BMAD Workflow",
      description: `Soft-cancel a running workflow. project_root is OPTIONAL; defaults to the MCP server's startup working directory (${SERVER_START_CWD}).`,
      inputSchema: {
        project_root: z
          .string()
          .optional()
          .describe(
            `Project root path. Optional — defaults to the MCP server's startup working directory (${SERVER_START_CWD}).`,
          ),
      },
    },
    async (args) => {
      try {
        const projectRoot = args.project_root?.trim() || SERVER_START_CWD;
        const state = await workflowEngine.cancel(projectRoot);
        return {
          content: [{ type: "text", text: `Workflow ${state.workflowId} cancelled.` }],
          structuredContent: { workflowId: state.workflowId, status: state.status },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "list_bmad_batches",
    {
      title: "List BMAD Batches",
      description: `List available batches under output_dir/planning-artifacts for pipeline workflow. project_root is OPTIONAL; defaults to the MCP server's startup working directory (${SERVER_START_CWD}).`,
      inputSchema: {
        project_root: z
          .string()
          .optional()
          .describe(
            `Project root path. Optional — defaults to the MCP server's startup working directory (${SERVER_START_CWD}).`,
          ),
        output_dir: z.string().describe("Same output_dir convention as start_bmad_workflow (required)"),
      },
    },
    async (args) => {
      try {
        const projectRoot = args.project_root?.trim() || SERVER_START_CWD;
        const batches = await workflowEngine.listBatches({
          projectRoot,
          outputDir: args.output_dir,
        });

        if (batches.length === 0) {
          return {
            content: [{ type: "text", text: "No batches found." }],
            structuredContent: { batches: [] },
          };
        }

        const text = batches
          .map(
            (b) =>
              `- ${b.name} | PRD:${b.hasPrd} Epics:${b.hasEpics} Sprint:${b.hasSprintStatus} (${b.sprintStatusFormat ?? "n/a"})`,
          )
          .join("\n");

        return {
          content: [{ type: "text", text: `Found ${batches.length} batch(es):\n${text}` }],
          structuredContent: { batches: batches as unknown as Record<string, unknown>[] },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    },
  );

  return server;
}
