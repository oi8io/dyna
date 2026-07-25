import type { GeneratedWorkspace } from "@/server/workspace/schema";
import { validateWorkspace } from "@/server/workspace/schema";

const TEMPLATE_FILES: GeneratedWorkspace["files"] = [
  {
    path: "package.json",
    content: JSON.stringify(
      {
        private: true,
        type: "module",
        scripts: { build: "node build.mjs" },
        dependencies: {
          esbuild: "0.28.1",
          react: "19.2.8",
          "react-dom": "19.2.8",
        },
      },
      null,
      2,
    ),
  },
  {
    path: "tsconfig.json",
    content: JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          lib: ["DOM", "ES2022"],
          strict: true,
          jsx: "react-jsx",
          module: "ESNext",
          moduleResolution: "Bundler",
          noEmit: true,
          skipLibCheck: true,
        },
        include: ["src"],
      },
      null,
      2,
    ),
  },
  {
    path: "index.html",
    // The base layer runs before the agent's stylesheet, so a generated game
    // can still override any of it. Its job is to guarantee the artifact fits
    // whatever box the preview gives it: the same HTML is embedded in a narrow
    // builder pane, a full-width play page and a phone.
    content: `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>Dyna Game</title><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{display:flex;align-items:center;justify-content:center}#root{width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden}#root>*{max-width:100%;max-height:100%}canvas,svg,img,video{max-width:100%;max-height:100%}</style><!-- DYNA_STYLE --></head><body><div id="root"></div><!-- DYNA_SCRIPT --></body></html>`,
  },
  {
    path: "build.mjs",
    content: `import * as esbuild from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const result = await esbuild.build({
  entryPoints: ["src/main.tsx"],
  // Required: with write:false and a CSS import, esbuild refuses to emit
  // without somewhere to name the outputs. Its absence made every sandbox
  // build fail on a project that built fine locally.
  outdir: "dist",
  bundle: true,
  write: false,
  minify: true,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  loader: { ".css": "css" },
});
const js = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text ?? "";
const css = result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
const shell = await readFile("index.html", "utf8");
const html = shell
  .replace("<!-- DYNA_STYLE -->", "<style>" + css.replaceAll("</style", "<\\\\/style") + "</style>")
  .replace("<!-- DYNA_SCRIPT -->", "<script>" + js.replaceAll("</script", "<\\\\/script") + "</scr" + "ipt>");
await mkdir("dist", { recursive: true });
await writeFile("dist/index.html", html);
console.log("built dist/index.html", html.length, "bytes");`,
  },
  {
    path: "src/main.tsx",
    content: `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);`,
  },
];

export function createGameWorkspace(input: {
  title: string;
  summary: string;
  agentFiles: GeneratedWorkspace["files"];
}) {
  return validateWorkspace({
    title: input.title,
    summary: input.summary,
    files: [...TEMPLATE_FILES, ...input.agentFiles],
  });
}
