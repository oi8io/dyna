import { z } from "zod";

const MAX_FILE_BYTES = 200_000;
const MAX_WORKSPACE_BYTES = 800_000;
const MAX_FILES = 24;
const ALLOWED_ROOT_FILES = new Set([
  "index.html",
  "package.json",
  "build.mjs",
  "tsconfig.json",
  "README.md",
  // The intent spec. It rides along in the snapshot so versions, publishes and
  // remixes carry it for free; the build never bundles it.
  "SPEC.md",
]);
const ALLOWED_DIRECTORIES = ["src/", "public/"];

export const generatedFileSchema = z.object({
  path: z.string().min(1).max(240),
  content: z.string().max(MAX_FILE_BYTES),
});

export const generatedWorkspaceSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  files: z.array(generatedFileSchema).min(1).max(MAX_FILES),
});

export type GeneratedWorkspace = z.infer<typeof generatedWorkspaceSchema>;

export class WorkspaceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceValidationError";
  }
}

export function normalizeWorkspacePath(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\/+/, "");

  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    normalized.split("/").includes("..") ||
    normalized.split("/").includes(".")
  ) {
    throw new WorkspaceValidationError(`Unsafe file path: ${path}`);
  }

  if (
    !ALLOWED_ROOT_FILES.has(normalized) &&
    !ALLOWED_DIRECTORIES.some((directory) => normalized.startsWith(directory))
  ) {
    throw new WorkspaceValidationError(`File is outside the allowed directories: ${path}`);
  }

  return normalized;
}

export function validateWorkspace(input: unknown): GeneratedWorkspace {
  const workspace = generatedWorkspaceSchema.parse(input);
  const seen = new Set<string>();
  let totalBytes = 0;

  const files = workspace.files.map((file) => {
    const path = normalizeWorkspacePath(file.path);
    if (seen.has(path)) {
      throw new WorkspaceValidationError(`Duplicate file path: ${path}`);
    }
    seen.add(path);
    totalBytes += new TextEncoder().encode(file.content).byteLength;
    return { ...file, path };
  });

  if (!seen.has("index.html")) {
    throw new WorkspaceValidationError("The generated workspace must contain index.html");
  }
  if (totalBytes > MAX_WORKSPACE_BYTES) {
    throw new WorkspaceValidationError("The generated workspace exceeds the size limit");
  }

  return { ...workspace, files };
}

const EDITABLE_EXACT_PATHS = new Set([
  "README.md",
  "SPEC.md",
  "src/App.tsx",
  "src/styles.css",
]);
const EDITABLE_DIRECTORIES = ["src/game/", "src/components/game/"];

export function isEditableAgentPath(rawPath: string) {
  try {
    const path = normalizeWorkspacePath(rawPath);
    return (
      EDITABLE_EXACT_PATHS.has(path) ||
      EDITABLE_DIRECTORIES.some((directory) => path.startsWith(directory))
    );
  } catch {
    return false;
  }
}

export function validateAgentFiles(input: unknown) {
  const files = z.array(generatedFileSchema).min(1).max(16).parse(input);
  const seen = new Set<string>();

  return files.map((file) => {
    const path = normalizeWorkspacePath(file.path);
    if (
      !EDITABLE_EXACT_PATHS.has(path) &&
      !EDITABLE_DIRECTORIES.some((directory) => path.startsWith(directory))
    ) {
      throw new WorkspaceValidationError(`The agent may not modify the template file: ${path}`);
    }
    if (seen.has(path)) {
      throw new WorkspaceValidationError(`Duplicate file path: ${path}`);
    }
    seen.add(path);
    return { ...file, path };
  });
}

export type AgentFile = z.infer<typeof generatedFileSchema>;

/** The agent-writable subset of a workspace, i.e. everything not platform-owned. */
export function extractAgentFiles(workspace: GeneratedWorkspace): AgentFile[] {
  return workspace.files
    .filter((file) => isEditableAgentPath(file.path))
    .map((file) => ({ path: file.path, content: file.content }));
}

/**
 * Applies an incremental edit on top of the previous agent files.
 *
 * Asking the model to re-emit every file on every turn is what makes unrelated
 * code drift: a one-line request regenerates the whole game. Here it returns
 * only what it touched, and everything else is carried over byte for byte.
 */
export function mergeAgentFiles(
  previous: AgentFile[],
  changed: AgentFile[],
  deleted: string[] = [],
): AgentFile[] {
  const merged = new Map(previous.map((file) => [file.path, file]));

  for (const path of deleted) {
    const normalized = normalizeWorkspacePath(path);
    if (!isEditableAgentPath(normalized)) {
      throw new WorkspaceValidationError(`The agent may not delete the template file: ${path}`);
    }
    merged.delete(normalized);
  }
  for (const file of changed) {
    merged.set(file.path, file);
  }

  const files = [...merged.values()];
  if (!files.length) {
    throw new WorkspaceValidationError("The merge left no editable files");
  }
  // Re-validating the merged set keeps the whitelist authoritative even when
  // the carried-over half came from an older, differently-validated version.
  return validateAgentFiles(files);
}

export function redactBuildLog(value: string) {
  return value
    .replace(/sk-[a-zA-Z0-9_-]{12,}/g, "[REDACTED_API_KEY]")
    .replace(/sb_secret_[a-zA-Z0-9_-]+/g, "[REDACTED_SUPABASE_KEY]")
    .slice(0, 20_000);
}
