export const SERVER_NAME = "bmad-workflow-mcp";
export const SERVER_VERSION = "0.2.0";

export const STATE_FILENAME = ".bmad-workflow-state.json";
export const AUDIT_LOG_FILENAME = "audit-log.json";

export const MAX_STEP_RETRIES = 2;

export const PLANNING_ARTIFACTS_DIR = "planning-artifacts";
export const IMPLEMENTATION_ARTIFACTS_DIR = "implementation-artifacts";
export const PIPELINE_RUN_SUBDIR = "mcp-workflow-run";

export const PLANNING_STEPS = [
  "discovery",
  "user_stories",
  "acceptance_criteria",
  "architecture",
  "task_breakdown",
  "code_generation",
  "code_review",
  "audit_report",
] as const;

export const PIPELINE_STEPS = [
  "story_discovery",
  "create_story",
  "development",
  "testing",
  "code_review_pipeline",
  "status_update",
  "checkpoint",
  "completion_audit",
] as const;

export const PLANNING_STEP_LABELS: Record<(typeof PLANNING_STEPS)[number], string> = {
  discovery: "需求发现",
  user_stories: "用户故事生成",
  acceptance_criteria: "验收标准定义",
  architecture: "架构设计建议",
  task_breakdown: "任务拆解",
  code_generation: "代码生成",
  code_review: "代码审查",
  audit_report: "审计与报告",
};

export const PIPELINE_STEP_LABELS: Record<(typeof PIPELINE_STEPS)[number], string> = {
  story_discovery: "Story Discovery",
  create_story: "Create Story",
  development: "Development",
  testing: "Testing",
  code_review_pipeline: "Code Review",
  status_update: "Status Update",
  checkpoint: "Checkpoint",
  completion_audit: "Completion Audit",
};

export const PLANNING_OUTPUT_FILES: Record<(typeof PLANNING_STEPS)[number], string> = {
  discovery: "01-prd.md",
  user_stories: "02-user-stories.md",
  acceptance_criteria: "03-acceptance-criteria.md",
  architecture: "04-architecture.md",
  task_breakdown: "05-tasks.md",
  code_generation: "06-code-skeleton/README.md",
  code_review: "07-code-review.md",
  audit_report: "final-report.md",
};

export const PIPELINE_OUTPUT_FILES: Record<(typeof PIPELINE_STEPS)[number], string> = {
  story_discovery: "01-story-discovery.md",
  create_story: "02-create-story.md",
  development: "03-development.md",
  testing: "04-testing.md",
  code_review_pipeline: "05-code-review.md",
  status_update: "06-status-update.md",
  checkpoint: "07-checkpoint.md",
  completion_audit: "08-completion-audit.md",
};

export function getStepLabel(workflowType: "planning" | "pipeline", stepId: string): string {
  if (workflowType === "planning") {
    return PLANNING_STEP_LABELS[stepId as (typeof PLANNING_STEPS)[number]] ?? stepId;
  }
  return PIPELINE_STEP_LABELS[stepId as (typeof PIPELINE_STEPS)[number]] ?? stepId;
}

export function getOutputFile(
  workflowType: "planning" | "pipeline",
  stepId: string,
): string | undefined {
  if (workflowType === "planning") {
    return PLANNING_OUTPUT_FILES[stepId as (typeof PLANNING_STEPS)[number]];
  }
  return PIPELINE_OUTPUT_FILES[stepId as (typeof PIPELINE_STEPS)[number]];
}
