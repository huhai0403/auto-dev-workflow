import path from "node:path";
import { randomUUID } from "node:crypto";

export function nowIso(): string {
  return new Date().toISOString();
}

export function createWorkflowId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `bmad-${date}-${randomUUID().slice(0, 8)}`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "feature";
}

export function joinPath(base: string, ...segments: string[]): string {
  return path.resolve(base, ...segments);
}

export function truncate(text: string, max = 200): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function normalizeBatchName(name: string): string {
  return name.toLowerCase().replace(/\./g, "").replace(/[_\s]+/g, "-");
}

export function batchNamesMatch(a: string, b: string): boolean {
  const na = normalizeBatchName(a);
  const nb = normalizeBatchName(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}
