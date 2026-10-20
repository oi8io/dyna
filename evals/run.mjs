#!/usr/bin/env node
/**
 * Entry point for the offline evaluation harness.
 *
 * The runner is TypeScript that imports from `@/server/**`, and the repo has no
 * TS runner (no ts-node, no tsx) — but it does have esbuild, because the product
 * builds generated games with it. So this script bundles the runner with the
 * dependency that is already here, then imports the result. No new dependency,
 * and the runner is typechecked by `pnpm typecheck` like everything else.
 */
import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.dirname(new URL(import.meta.url).pathname);
const projectRoot = path.resolve(root, "..");
const cacheDir = path.join(root, ".cache");
const outFile = path.join(cacheDir, "main.mjs");

// Live runs need the same variables the app needs. `.env.local` is the file the
// README already tells you to create, so it is the one the harness reads.
for (const file of [".env.local", ".env"]) {
  const candidate = path.join(projectRoot, file);
  if (!existsSync(candidate)) continue;
  try {
    process.loadEnvFile(candidate);
  } catch {
    // An unreadable env file is only fatal for a live run, and the provider
    // will say so far more clearly than a parse error here would.
  }
  break;
}

/** `server-only` exists only inside the Next.js bundler. */
const serverOnlyStub = {
  name: "server-only-stub",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^server-only$/ }, () => ({
      path: path.join(root, "runner", "stubs", "server-only.js"),
    }));
  },
};

await rm(cacheDir, { recursive: true, force: true });
await mkdir(cacheDir, { recursive: true });

await build({
  absWorkingDir: projectRoot,
  entryPoints: [path.join(root, "runner", "main.ts")],
  outfile: outFile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // Everything in node_modules stays external: it is already installed, and
  // bundling zod or esbuild into the runner would only slow the start-up.
  packages: "external",
  tsconfig: path.join(projectRoot, "tsconfig.json"),
  plugins: [serverOnlyStub],
  sourcemap: "inline",
  logLevel: "warning",
});

await import(pathToFileURL(outFile).href);
