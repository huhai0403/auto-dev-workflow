import fs from "node:fs/promises";
import path from "node:path";
import {
  IMPLEMENTATION_ARTIFACTS_DIR,
  PLANNING_ARTIFACTS_DIR,
  PIPELINE_RUN_SUBDIR,
} from "../constants.js";
import type { BatchContext, BatchInfo, StoryEntry } from "../types.js";
import { batchNamesMatch, joinPath, normalizeBatchName } from "../utils.js";

const PLANNING_MARKERS = ["prd", "epics", "architecture"];

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function dirHasPlanningArtifacts(dir: string): Promise<{ hasPrd: boolean; hasEpics: boolean }> {
  let hasPrd = false;
  let hasEpics = false;
  try {
    const files = await fs.readdir(dir);
    for (const f of files) {
      const lower = f.toLowerCase();
      if (lower.includes("prd")) hasPrd = true;
      if (lower.includes("epic")) hasEpics = true;
    }
  } catch {
    /* empty */
  }
  return { hasPrd, hasEpics };
}

function generateBatchVariations(name: string): string[] {
  const variations = new Set<string>([name]);
  variations.add(name.replace(/\./g, ""));
  variations.add(name.replace(/\./g, "-"));
  variations.add(name.toLowerCase());
  variations.add(normalizeBatchName(name));
  return [...variations];
}

async function findImplementationBatchDir(
  implRoot: string,
  planningBatchName: string,
): Promise<string | null> {
  if (!(await pathExists(implRoot))) return null;

  const entries = await fs.readdir(implRoot, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  for (const variation of generateBatchVariations(planningBatchName)) {
    const exact = dirs.find((d) => d === variation);
    if (exact) return joinPath(implRoot, exact);
  }

  for (const variation of generateBatchVariations(planningBatchName)) {
    const fuzzy = dirs.find((d) => batchNamesMatch(d, variation));
    if (fuzzy) return joinPath(implRoot, fuzzy);
  }

  return null;
}

async function findSprintStatusFile(implDir: string): Promise<{
  path?: string;
  format?: "yaml" | "markdown";
}> {
  if (!(await pathExists(implDir))) return {};

  const files = await fs.readdir(implDir);
  const sprintFile = files.find((f) => /sprint-status/i.test(f) && /\.(md|yaml|yml)$/i.test(f));
  if (!sprintFile) return {};

  const fullPath = joinPath(implDir, sprintFile);
  const format = sprintFile.endsWith(".md") ? "markdown" : "yaml";
  return { path: fullPath, format };
}

export function getArtifactsRoot(projectRoot: string, outputDir: string): string {
  return joinPath(projectRoot, outputDir);
}

export async function listBatches(projectRoot: string, outputDir: string): Promise<BatchInfo[]> {
  const artifactsRoot = getArtifactsRoot(projectRoot, outputDir);
  const planningRoot = joinPath(artifactsRoot, PLANNING_ARTIFACTS_DIR);
  const implRoot = joinPath(artifactsRoot, IMPLEMENTATION_ARTIFACTS_DIR);

  if (!(await pathExists(planningRoot))) {
    return [];
  }

  const entries = await fs.readdir(planningRoot, { withFileTypes: true });
  const batches: BatchInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const planningPath = joinPath(planningRoot, entry.name);
    const { hasPrd, hasEpics } = await dirHasPlanningArtifacts(planningPath);
    if (!hasPrd && !hasEpics) continue;

    const implPath = (await findImplementationBatchDir(implRoot, entry.name)) ?? joinPath(implRoot, entry.name);
    const sprint = await findSprintStatusFile(implPath);

    batches.push({
      name: entry.name,
      planningPath,
      implementationPath: implPath,
      hasPrd,
      hasEpics,
      hasSprintStatus: Boolean(sprint.path),
      sprintStatusFormat: sprint.format,
    });
  }

  return batches;
}

export async function resolveBatch(options: {
  projectRoot: string;
  outputDir: string;
  batch?: string;
  epic?: string;
  story?: string;
}): Promise<BatchContext> {
  const batches = await listBatches(options.projectRoot, options.outputDir);

  if (batches.length === 0) {
    throw new Error(
      `No batches found under ${joinPath(getArtifactsRoot(options.projectRoot, options.outputDir), PLANNING_ARTIFACTS_DIR)}. ` +
        "Run planning workflow first or check output_dir.",
    );
  }

  let selected: BatchInfo;
  if (options.batch) {
    const match = batches.find((b) => batchNamesMatch(b.name, options.batch!));
    if (!match) {
      throw new Error(
        `Batch "${options.batch}" not found. Available: ${batches.map((b) => b.name).join(", ")}`,
      );
    }
    selected = match;
  } else if (batches.length === 1) {
    selected = batches[0];
  } else {
    throw new Error(
      `Multiple batches found (${batches.map((b) => b.name).join(", ")}). Specify batch parameter.`,
    );
  }

  const sprint = await findSprintStatusFile(selected.implementationPath);
  let stories: StoryEntry[] = [];

  if (sprint.path && sprint.format) {
    stories = await parseSprintStatus(sprint.path, sprint.format);
    stories = filterStories(stories, options.epic, options.story);
  }

  const pipelineOutputPath = joinPath(selected.implementationPath, PIPELINE_RUN_SUBDIR);

  return {
    batchName: selected.name,
    planningArtifactsPath: selected.planningPath,
    implementationArtifactsPath: selected.implementationPath,
    sprintStatusPath: sprint.path,
    sprintStatusFormat: sprint.format,
    targetEpic: options.epic,
    targetStory: options.story,
    selectedStories: stories,
    pipelineOutputPath,
  };
}

export function filterStories(stories: StoryEntry[], epic?: string, story?: string): StoryEntry[] {
  let filtered = stories.filter((s) => !/^epic-/i.test(s.key));

  if (epic) {
    const epicPrefix = epic.replace(/^epic-/i, "");
    filtered = filtered.filter((s) => s.key.startsWith(`${epicPrefix}-`) || s.epic === epic);
  }

  if (story) {
    filtered = filtered.filter(
      (s) => s.key === story || s.key.startsWith(story) || batchNamesMatch(s.key, story),
    );
  }

  return filtered;
}

export async function parseSprintStatus(
  filePath: string,
  format: "yaml" | "markdown",
): Promise<StoryEntry[]> {
  const content = await fs.readFile(filePath, "utf-8");

  if (format === "markdown") {
    return parseMarkdownSprintStatus(content);
  }

  return parseYamlSprintStatus(content);
}

function parseMarkdownSprintStatus(content: string): StoryEntry[] {
  const stories: StoryEntry[] = [];
  const devSection = content.match(/## Development Status([\s\S]*?)(?=##|$)/i);
  if (!devSection) return stories;

  const section = devSection[1];
  const epicMatch = section.match(/### Epic (\d+):[^\n]*/g) ?? [];
  const epicBlocks = section.split(/### Epic \d+:/);

  for (let i = 1; i < epicBlocks.length; i++) {
    const epicNum = epicMatch[i - 1]?.match(/Epic (\d+)/)?.[1] ?? String(i);
    const block = epicBlocks[i];
    const rows = block.split("\n").filter((line) => line.trim().startsWith("|") && !line.includes("---"));

    for (const row of rows) {
      const cols = row
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      if (cols.length < 3) continue;

      const [key, title, status] = cols;
      if (/^epic-/i.test(key)) continue;
      if (!/^\d+-\d+/.test(key)) continue;

      stories.push({
        key,
        title,
        status: status.toLowerCase(),
        epic: epicNum,
        sprint: cols[3],
        priority: cols[4],
        filePattern: `${key}-*`,
      });
    }
  }

  return stories;
}

function parseYamlSprintStatus(content: string): StoryEntry[] {
  const stories: StoryEntry[] = [];
  const devMatch = content.match(/development_status:\s*\n([\s\S]*?)(?:\n\S|$)/);

  if (devMatch) {
    const lines = devMatch[1].split("\n");
    for (const line of lines) {
      const m = line.match(/^\s*["']?([^"':\s]+)["']?\s*:\s*["']?([^"'\n]+)["']?\s*$/);
      if (!m) continue;
      const [, key, status] = m;
      if (/^epic-/i.test(key)) continue;
      stories.push({
        key,
        title: key,
        status: status.trim().toLowerCase(),
        filePattern: `${key}-*`,
      });
    }
    return stories;
  }

  // Simple key: status lines anywhere in file
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*(\d+-\d+[\w-]*)\s*:\s*(\S+)/);
    if (m) {
      stories.push({ key: m[1], title: m[1], status: m[2].toLowerCase(), filePattern: `${m[1]}-*` });
    }
  }

  return stories;
}

export async function globStoryFile(implDir: string, filePattern: string): Promise<string | null> {
  const prefix = filePattern.replace("*", "");
  try {
    const files = await fs.readdir(implDir);
    const matches = files.filter((f) => f.startsWith(prefix) && f.endsWith(".md"));
    if (matches.length === 0) return null;
    return joinPath(implDir, matches[0]);
  } catch {
    return null;
  }
}
