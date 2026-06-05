import type { BatchContext, StoryEntry } from "../types.js";
import { type CodeReviewResult, renderReviewMarkdown } from "../services/code-reviewer.js";
import { type BatchAuditResult, renderAuditMarkdown } from "../services/evidence-verifier.js";

export function buildStoryDiscoveryReport(batch: BatchContext): string {
  const stories = batch.selectedStories;
  const nextStory = pickNextStory(stories);

  return `# Step 01: Story Discovery

| Field | Value |
|-------|-------|
| Batch | ${batch.batchName} |
| Sprint Status | ${batch.sprintStatusPath ?? "not found"} |
| Format | ${batch.sprintStatusFormat ?? "n/a"} |
| Target Epic | ${batch.targetEpic ?? "all"} |
| Target Story | ${batch.targetStory ?? "auto"} |

## Selected Stories (${stories.length})

${stories.length === 0 ? "_No stories matched filters._" : stories.map(formatStoryRow).join("\n")}

## Next Story to Process

${nextStory ? formatStoryDetail(nextStory) : "_No eligible story found (all done or blocked)._"}
`;
}

export function buildCreateStoryReport(batch: BatchContext, story: StoryEntry | null): string {
  return `# Step 02: Create Story

## Story Context

${story ? formatStoryDetail(story) : "_No story selected — check discovery step._"}

## Batch Artifacts

- Planning: \`${batch.planningArtifactsPath}\`
- Implementation: \`${batch.implementationArtifactsPath}\`

## Story File Template

\`\`\`markdown
# Story ${story?.key ?? "X-Y"}: ${story?.title ?? "Title"}

## User Story
As a **user**, I want **...**, so that **...**.

## Acceptance Criteria
### AC-1
**Given** ... **When** ... **Then** ...

## Tasks
- [ ] Task 1
- [ ] Task 2

## Dev Agent Record
_(filled during development)_

## Test Output
_(filled during testing)_

## Lint Output
_(filled during code review)_

## Code Review Summary
_(filled during code review)_

## Definition of Done
- [ ] All AC verified
- [ ] Tests pass
- [ ] Lint passes
- [ ] Code review verdict recorded

## Status
${story?.status ?? "ready-for-dev"}
\`\`\`
`;
}

export function buildDevelopmentReport(story: StoryEntry | null): string {
  return `# Step 03: Development

## Story: ${story?.key ?? "n/a"}

Implementation checklist for MCP pipeline mode:

- [ ] Load story file from implementation artifacts
- [ ] Implement tasks per acceptance criteria
- [ ] Update Dev Agent Record section
- [ ] Update File List and Change Log
- [ ] Add test cases covering all ACs

## Notes

This MCP step records the development phase boundary. Actual code changes should be performed by the connected AI agent using the story file as context.
`;
}

export function buildTestingReport(
  story: StoryEntry | null,
  testOutput?: string,
): string {
  return `# Step 04: Testing

## Story: ${story?.key ?? "n/a"}

| Check | Result |
|-------|--------|
| Unit tests | ${testOutput ? "Executed" : "Skipped (no test:unit script)"} |

## Test Output

\`\`\`
${testOutput ?? "(no test output — run npm run test:unit)"}
\`\`\`

## DoD Checklist

- [ ] All acceptance criteria verified
- [ ] Unit tests pass
- [ ] Lint passes (see code review step)

## Evidence Gate (Checkpoint 1/4)

This step provides evidence for: **test_output** (must be non-empty + non-placeholder).
`;
}

export function buildPipelineCodeReviewReport(
  story: StoryEntry | null,
  review: CodeReviewResult,
): string {
  const verdictBanner =
    review.verdict === "approve"
      ? "✅ **APPROVE**"
      : review.verdict === "blocked"
        ? "⛔ **BLOCKED**"
        : "⚠️ **CHANGES REQUESTED**";

  return `# Step 05: Code Review (AI + Lint)

## Story: ${story?.key ?? "n/a"}

| Field | Value |
|-------|-------|
| Verdict | ${verdictBanner} |
| Source | ${review.reviewSource} |
| Files reviewed | ${review.reviewedFiles.length} |
| Findings | ${review.findings.length} (${review.findings.filter((f) => f.severity === "critical").length} critical) |

${renderReviewMarkdown(review)}

## Evidence Gate (Checkpoint 2/4)

This step provides evidence for: **lint_output** + **code_review_summary** (must include a verdict).
`;
}

export function buildStatusUpdateReport(batch: BatchContext, story: StoryEntry | null): string {
  return `# Step 06: Status Update

## Proposed Status Change

| Story | From | To |
|-------|------|-----|
| ${story?.key ?? "n/a"} | ${story?.status ?? "unknown"} | review |

## Sprint Status File

\`${batch.sprintStatusPath ?? "not found"}\`

_Update the sprint-status file manually or via agent after verification._

## Evidence Gate (Checkpoint 3/4 — pre-done)

Before marking a story as **done**, the following must be present in the story file:
- [ ] Test Output section (non-empty)
- [ ] Lint Output section (non-empty)
- [ ] Code Review Summary with verdict (not BLOCKED)
- [ ] Definition of Done — all items checked
`;
}

export function buildCheckpointReport(story: StoryEntry | null): string {
  return `# Step 07: Checkpoint

## Auto-continuing (MCP headless mode)

Checkpoint passed automatically — no user interaction required.

## Story

${story ? formatStoryDetail(story) : "_none_"}

## Evidence Gate (Checkpoint 4/4 — re-verify)

Re-running the 4-checkpoint evidence gate before completion audit.
`;
}

export function buildCompletionAuditReport(
  batch: BatchContext,
  stories: StoryEntry[],
  auditSummary: { completedSteps: string[]; totalTokens: number; totalDurationMs: number },
  audit: BatchAuditResult | null,
): string {
  const baseLines: string[] = [
    `# Step 08: Completion Audit`,
    ``,
    `| Field | Value |`,
    `|-------|-------|`,
    `| Batch | ${batch.batchName} |`,
    `| Stories in scope | ${stories.length} |`,
    `| Duration | ${Math.round(auditSummary.totalDurationMs / 1000)}s |`,
    `| Token estimate | ~${auditSummary.totalTokens} |`,
    ``,
    `## Pipeline Steps Completed`,
    ``,
    auditSummary.completedSteps.map((s) => `- ✅ ${s}`).join("\n"),
    ``,
  ];

  if (audit) {
    baseLines.push(`## 4-Checkpoint Evidence Gate Results`, ``);
    baseLines.push(audit.allPassed
      ? `**All 4 evidence checks passed for every story.** Stories can be marked done.`
      : `**❌ ${audit.failedStoryKeys.length} story/stories failed the 4-checkpoint audit.** See per-story detail below.`);
    baseLines.push(``);
    baseLines.push(renderAuditMarkdown(audit));
  } else if (stories.length > 0) {
    baseLines.push(`## Stories in Scope`, ``);
    for (const s of stories) {
      baseLines.push(`- \`${s.key}\` — ${s.title} (${s.status})`);
    }
    baseLines.push(``);
    baseLines.push(`## 4-Checkpoint Evidence Gate`, ``);
    baseLines.push(`No batch context available — audit skipped.`);
    baseLines.push(``);
  } else {
    baseLines.push(`## 4-Checkpoint Evidence Gate`, ``);
    baseLines.push(`No stories in scope — nothing to audit.`);
    baseLines.push(``);
  }

  baseLines.push(`---`, `*Generated by @huhai0403/bmad-workflow-mcp*`);
  return baseLines.join("\n");
}

function pickNextStory(stories: StoryEntry[]): StoryEntry | null {
  const priority = ["ready-for-dev", "in-progress", "backlog", "review", "blocked"];
  for (const status of priority) {
    const found = stories.find((s) => s.status === status);
    if (found) return found;
  }
  return stories[0] ?? null;
}

function formatStoryRow(s: StoryEntry): string {
  return `- **${s.key}** | ${s.title} | \`${s.status}\`${s.epic ? ` | Epic ${s.epic}` : ""}`;
}

function formatStoryDetail(s: StoryEntry): string {
  return `- **Key**: ${s.key}
- **Title**: ${s.title}
- **Status**: ${s.status}
- **Epic**: ${s.epic ?? "n/a"}
- **File pattern**: ${s.filePattern ?? "n/a"}`;
}

export function getPrimaryStory(batch: BatchContext): StoryEntry | null {
  if (batch.selectedStories.length === 0) return null;
  return pickNextStory(batch.selectedStories);
}
