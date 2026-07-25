import { build } from "esbuild";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { GeneratedWorkspace } from "@/server/workspace/schema";
import { redactBuildLog } from "@/server/workspace/schema";
import { validateStandaloneHtml } from "@/server/build/validation";

export async function buildWorkspaceLocally(workspace: GeneratedWorkspace) {
  const buildRoot = await mkdtemp(path.join(tmpdir(), "dyna-build-"));

  try {
    await Promise.all(
      workspace.files.map(async (file) => {
        const destination = path.join(buildRoot, file.path);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, file.content, "utf8");
      }),
    );

    const result = await build({
      absWorkingDir: buildRoot,
      entryPoints: ["src/main.tsx"],
      outdir: "dist",
      bundle: true,
      write: false,
      minify: true,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      loader: { ".css": "css" },
      nodePaths: [path.join(process.cwd(), "node_modules")],
      logLevel: "silent",
    });
    const javascript =
      result.outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "";
    const stylesheet =
      result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
    if (!javascript) {
      throw new Error("本地构建没有生成 JavaScript 产物");
    }

    const shell = await readFile(path.join(buildRoot, "index.html"), "utf8");
    const artifactHtml = shell
      .replace(
        "<!-- DYNA_STYLE -->",
        `<style>${stylesheet.replaceAll("</style", "<\\/style")}</style>`,
      )
      .replace(
        "<!-- DYNA_SCRIPT -->",
        `<script>${javascript.replaceAll("</script", "<\\/script")}</script>`,
      );
    validateStandaloneHtml(artifactHtml);

    return {
      artifactHtml,
      executor: "local-esbuild" as const,
      logs: [
        {
          level: "info" as const,
          message:
            "本地安全构建完成：仅由平台调用 esbuild 解析和打包源码，未执行生成代码。",
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(redactBuildLog(message));
  } finally {
    await rm(buildRoot, { recursive: true, force: true });
  }
}
