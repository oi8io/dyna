import type { GeneratedWorkspace } from "@/server/workspace/schema";

/**
 * Checks that every relative import resolves inside the workspace.
 *
 * Writing one file per request makes cross-file references the main failure
 * mode: a file two directories deep gets `../game/engine` when it needed
 * `../../game/engine`, and nothing notices until a sandbox has been created,
 * dependencies installed and a bundler run — several seconds and a repair call
 * later, for a mistake that is decidable from the file list alone.
 *
 * Deliberately a scanner, not a parser. It over-reports nothing and under-
 * reports imports built from expressions, which the template does not allow.
 */

const IMPORT_PATTERN =
  /(?:^|[\s;{(])(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;

/** Extensions esbuild will try when the specifier has none. */
const RESOLVE_ORDER = ["", ".ts", ".tsx", ".js", ".jsx", ".css"];

export interface UnresolvedImport {
  from: string;
  specifier: string;
  /** The path the specifier pointed at, for the error message. */
  resolved: string;
}

function normalize(segments: string[]) {
  const out: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

function resolveRelative(fromPath: string, specifier: string) {
  const base = fromPath.split("/").slice(0, -1);
  return normalize([...base, ...specifier.split("/")]);
}

export function findUnresolvedImports(
  workspace: GeneratedWorkspace,
): UnresolvedImport[] {
  const present = new Set(workspace.files.map((file) => file.path));
  const problems: UnresolvedImport[] = [];

  for (const file of workspace.files) {
    if (!/\.(ts|tsx|js|jsx)$/.test(file.path)) continue;

    for (const match of file.content.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1] ?? match[2];
      // Bare specifiers are dependencies, resolved by the platform-owned
      // package.json rather than by the workspace.
      if (!specifier?.startsWith(".")) continue;

      const target = resolveRelative(file.path, specifier);
      const found = RESOLVE_ORDER.some(
        (extension) =>
          present.has(`${target}${extension}`) ||
          present.has(`${target}/index${extension}`),
      );
      if (!found) {
        problems.push({ from: file.path, specifier, resolved: target });
      }
    }
  }

  return problems;
}

/** Human-readable summary, suitable for feeding straight back to the model. */
export function describeUnresolvedImports(problems: UnresolvedImport[]) {
  return problems
    .map(
      (problem) =>
        `${problem.from} imports "${problem.specifier}", which resolves to ${problem.resolved}, but no such file exists in the project.`,
    )
    .join("\n");
}

/**
 * Whether a repair pass could possibly help.
 *
 * The agent may only write a fixed set of paths. A build error naming none of
 * the files it just wrote lives in a platform-owned file or in the toolchain,
 * and no amount of rewriting will move it. Retrying anyway is how a generation
 * spends its entire budget without ever converging.
 */
export function isRepairableByAgent(detail: string, writtenPaths: string[]) {
  if (!writtenPaths.length) return false;
  return writtenPaths.some((path) => detail.includes(path));
}
