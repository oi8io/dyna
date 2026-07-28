import { type Locale, detectContentLocale } from "@/lib/i18n/config";
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
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>Dyna Game</title><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{display:flex;align-items:center;justify-content:center}#root{width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden}#root>*{max-width:100%;max-height:100%}canvas,svg,img,video{max-width:100%;max-height:100%}</style><!-- DYNA_STYLE --></head><body><div id="root"></div><script>(function(){function s(k,m){try{parent.postMessage({source:"dyna-preview",kind:k,message:String(m||"")},"*")}catch(e){}}addEventListener("error",function(e){s("error",e.message||(e.error&&e.error.message))},true);addEventListener("unhandledrejection",function(e){s("error",(e.reason&&e.reason.message)||e.reason)});setTimeout(function(){var r=document.getElementById("root");s(r&&r.childElementCount>0?"ok":"empty","")},1200)})();<\/script><!-- DYNA_SCRIPT --></body></html>`,
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

/**
 * Stand-ins for the two files `src/main.tsx` imports by name.
 *
 * The entry point is platform-owned, so the platform has to guarantee it
 * resolves. Leaving that to the agent meant a plan that happened not to list
 * `src/App.tsx` — say, because it decided on a component file instead —
 * produced a workspace whose entry point referenced nothing, and no amount of
 * repair could recover it.
 *
 * Anything the agent writes replaces these. They exist so that a build is
 * always possible, not so that anyone ships them.
 */
const FALLBACK_COPY = {
  "zh-CN": {
    heading: "还没有内容",
    body: "这一版没有生成游戏主体，继续对话再试一次。",
  },
  en: {
    heading: "Nothing here yet",
    body: "This version produced no game. Keep the conversation going and try again.",
  },
} as const;

/**
 * The placeholder is the one thing here the user might actually read, so it
 * follows the language they wrote in — inferred from the project's own name and
 * summary, since this module never sees the request.
 */
function fallbackFiles(locale: Locale): GeneratedWorkspace["files"] {
  const copy = FALLBACK_COPY[locale];
  return [
    {
      path: "src/App.tsx",
      content: `export default function App() {
  return (
    <main className="game-shell">
      <h1>${copy.heading}</h1>
      <p>${copy.body}</p>
    </main>
  );
}
`,
    },
    {
      path: "src/styles.css",
      content: `.game-shell {
  display: grid;
  place-items: center;
  gap: 8px;
  width: 100%;
  height: 100%;
  font: 14px system-ui;
  text-align: center;
}
`,
    },
  ];
}

export function createGameWorkspace(input: {
  title: string;
  summary: string;
  agentFiles: GeneratedWorkspace["files"];
}) {
  // Later entries win, and duplicates would fail validation outright.
  const byPath = new Map<string, GeneratedWorkspace["files"][number]>();
  const locale = detectContentLocale(`${input.title} ${input.summary}`);
  for (const file of [
    ...TEMPLATE_FILES,
    ...fallbackFiles(locale),
    ...input.agentFiles,
  ]) {
    byPath.set(file.path, file);
  }

  return validateWorkspace({
    title: input.title,
    summary: input.summary,
    files: [...byPath.values()],
  });
}
