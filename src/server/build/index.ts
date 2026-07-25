import "server-only";

import { canUseVercelSandbox, getServerEnv } from "@/server/env";
import { buildWorkspaceLocally } from "@/server/build/local-esbuild";
import type { GeneratedWorkspace } from "@/server/workspace/schema";
import { redactBuildLog } from "@/server/workspace/schema";
import { validateStandaloneHtml } from "@/server/build/validation";

export interface BuildResult {
  artifactHtml: string;
  executor: "inline-validator" | "local-esbuild" | "vercel-sandbox";
  logs: Array<{ level: "info" | "error"; message: string }>;
}

async function validateInVercelSandbox(
  workspace: GeneratedWorkspace,
): Promise<BuildResult> {
  const { Sandbox } = await import("@vercel/sandbox");
  const env = getServerEnv();
  const sandbox = await Sandbox.create({
    runtime: env.SANDBOX_RUNTIME,
    resources: { vcpus: env.SANDBOX_VCPUS },
    timeout: env.SANDBOX_TIMEOUT_MS,
    networkPolicy: { allow: ["registry.npmjs.org"] },
    persistent: false,
  });

  try {
    await sandbox.writeFiles(
      workspace.files.map((file) => ({
        path: file.path,
        content: file.content,
      })),
    );
    const install = await sandbox.runCommand(
      "npm",
      ["install", "--no-audit", "--no-fund"],
      { timeoutMs: env.SANDBOX_TIMEOUT_MS },
    );
    const installOutput = redactBuildLog(await install.output("both"));
    if (install.exitCode !== 0) {
      throw new Error(installOutput || "Sandbox dependency install failed");
    }

    await sandbox.update({ networkPolicy: "deny-all" });
    const command = await sandbox.runCommand("npm", ["run", "build"], {
      timeoutMs: env.SANDBOX_TIMEOUT_MS,
    });
    const output = redactBuildLog(await command.output("both"));
    if (command.exitCode !== 0) {
      throw new Error(output || "Sandbox JavaScript validation failed");
    }
    const artifact = await sandbox.readFileToBuffer({
      path: "/vercel/sandbox/dist/index.html",
    });
    if (!artifact) throw new Error("Sandbox build did not produce dist/index.html");
    const builtHtml = artifact.toString("utf8");
    validateStandaloneHtml(builtHtml);

    return {
      artifactHtml: builtHtml,
      executor: "vercel-sandbox",
      logs: [
        { level: "info", message: "固定依赖安装完成。" },
        { level: "info", message: output.trim() },
      ],
    };
  } finally {
    await sandbox.stop().catch(() => undefined);
  }
}

export async function buildGeneratedWorkspace(
  workspace: GeneratedWorkspace,
  prebuiltArtifactHtml?: string,
): Promise<BuildResult> {
  if (prebuiltArtifactHtml) {
    validateStandaloneHtml(prebuiltArtifactHtml);
    return {
      artifactHtml: prebuiltArtifactHtml,
      executor: "inline-validator",
      logs: [
        {
          level: "info",
          message: "Fake Provider 工程源码已校验，并加载确定性的预构建产物。",
        },
      ],
    };
  }

  if (canUseVercelSandbox()) {
    return validateInVercelSandbox(workspace);
  }

  if (process.env.NODE_ENV !== "production") {
    return buildWorkspaceLocally(workspace);
  }

  throw new Error("实时生成需要 Vercel OIDC 才能安全构建");
}
