import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getStepLabel, SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { workflowEngine } from "./engine/workflow-engine.js";
import type { WorkflowRunResult } from "./types.js";

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
    `Completed steps: ${state.completedSteps.map((s) => getStepLabel(state.workflowType, s)).join(", ") || "(none)"}`,
  ].filter(Boolean);

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

  return lines.join("\n");
}

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
Set use_llm=true to enhance documents via OPENAI_API_KEY (falls back to templates).`,
      inputSchema: {
        project_root: z.string().describe("Project root path"),
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
        use_llm: z
          .boolean()
          .default(false)
          .describe("Use LLM API when OPENAI_API_KEY is set; fallback to templates"),
        batch: z.string().optional().describe("Batch name for pipeline workflow"),
        epic: z.string().optional().describe("Filter by epic number (e.g. '1')"),
        story: z.string().optional().describe("Filter by story key (e.g. '1-3')"),
      },
    },
    async (args) => {
      try {
        const result = await workflowEngine.start({
          projectRoot: args.project_root,
          outputDir: args.output_dir,
          requirementDescription: args.requirement_description,
          workflowType: args.workflow_type,
          mode: args.mode,
          includeCodegen: args.include_codegen,
          includeCodeReview: args.include_code_review,
          useLlm: args.use_llm,
          batch: args.batch,
          epic: args.epic,
          story: args.story,
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
            dryRunPreview: result.dryRunPreview,
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
      description: "Resume from .bmad-workflow-state.json in project_root.",
      inputSchema: {
        project_root: z.string(),
      },
    },
    async (args) => {
      try {
        const result = await workflowEngine.resume(args.project_root);
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
      description: "Query workflow progress.",
      inputSchema: {
        project_root: z.string(),
      },
    },
    async (args) => {
      try {
        const status = await workflowEngine.getStatus(args.project_root);
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
      description: "Soft-cancel a running workflow.",
      inputSchema: {
        project_root: z.string(),
      },
    },
    async (args) => {
      try {
        const state = await workflowEngine.cancel(args.project_root);
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
      description: "List available batches under output_dir/planning-artifacts for pipeline workflow.",
      inputSchema: {
        project_root: z.string(),
        output_dir: z.string().describe("Same output_dir convention as start_bmad_workflow"),
      },
    },
    async (args) => {
      try {
        const batches = await workflowEngine.listBatches({
          projectRoot: args.project_root,
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
