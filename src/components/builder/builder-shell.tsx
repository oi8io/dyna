"use client";

import {
  Code2,
  Eye,
  LoaderCircle,
  RotateCcw,
  Send,
  SquareTerminal,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";

import { ClarificationPanel } from "@/components/builder/clarification-panel";
import { GamePreview } from "@/components/builder/game-preview";
import { PublishPanel } from "@/components/builder/publish-panel";
import { useGenerationStream } from "@/components/builder/use-generation-stream";
import { CodeView } from "@/components/code/code-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type {
  Json,
  Message,
  Project,
  ProjectFile,
  WorkVisibility,
} from "@/types/database";

interface BuilderShellProps {
  project: Project;
  /** Absent until a generation has produced a runnable version. */
  artifactHtml?: string;
  versionNumber?: number;
  files: ProjectFile[];
  messages: Message[];
  buildLog?: Json;
  publishedSlug?: string;
  publishedVisibility?: WorkVisibility;
  /** `error_code` from the most recent failed job, when there is one. */
  lastErrorCode?: string;
  /**
   * True for a project that was created but never generated. The builder kicks
   * off the first run itself so the user watches the code appear here instead
   * of waiting on the previous page for a finished result.
   */
  autoStart?: boolean;
}

/**
 * Pulls the reason out of the assistant turn the failure handler wrote.
 *
 * The route already records both a readable message and, in development, the
 * redacted detail. Nothing used to render either of them, so a project whose
 * generation failed looked broken with no way to find out why.
 */
function findFailure(messages: Message[]) {
  for (const message of [...messages].reverse()) {
    const meta = message.metadata;
    if (
      meta &&
      typeof meta === "object" &&
      !Array.isArray(meta) &&
      meta.error === true
    ) {
      return {
        message: message.content,
        detail: typeof meta.detail === "string" ? meta.detail : undefined,
        at: message.created_at,
      };
    }
  }
  return undefined;
}

function buildLogMessage(entry: Json) {
  if (typeof entry === "string") return entry;
  if (
    entry &&
    typeof entry === "object" &&
    !Array.isArray(entry) &&
    typeof entry.message === "string"
  ) {
    return entry.message;
  }
  return JSON.stringify(entry);
}

export function BuilderShell({
  project,
  artifactHtml,
  versionNumber,
  files,
  messages: initialMessages,
  buildLog,
  publishedSlug,
  publishedVisibility,
  lastErrorCode,
  autoStart = false,
}: BuilderShellProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [prompt, setPrompt] = useState("");
  const [selectedFile, setSelectedFile] = useState(files[0]?.path);
  const [workspaceTab, setWorkspaceTab] = useState<
    "preview" | "code" | "console"
  >("preview");
  // A project with no runnable version keeps the same layout; only the right
  // pane changes. Replacing the whole screen with a recovery card threw away
  // the conversation, which is where the failure was actually explained.
  const hasVersion = Boolean(artifactHtml);
  const failure = findFailure(initialMessages);
  const { state: stream, start } = useGenerationStream();
  const busy = stream.busy;
  const error = stream.error;
  const messageScrollRef = useRef<HTMLDivElement>(null);

  // The conversation scrolls inside its own pane now, so new turns would
  // otherwise land below the fold.
  useEffect(() => {
    const scroller = messageScrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [messages.length, busy, stream.understanding, stream.questions.length]);
  const provider = [...initialMessages]
    .reverse()
    .map((message) =>
      message.metadata &&
      typeof message.metadata === "object" &&
      !Array.isArray(message.metadata) &&
      typeof message.metadata.provider === "string"
        ? message.metadata.provider
        : undefined,
    )
    .find(Boolean);

  async function submitTurn(content: string) {
    // Switch to the editor so the user watches the code appear rather than a
    // spinner. The tab stays wherever they move it afterwards.
    setWorkspaceTab("code");
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        project_id: project.id,
        role: "user",
        content,
        metadata: {},
        created_at: new Date().toISOString(),
      },
    ]);

    const result = await start(
      project.id,
      content,
      hasVersion ? "edit" : "create",
    );
    // The server is the source of truth for files, versions and credits; a
    // reload is the cheapest way to pick all of that up at once. A turn that
    // ended in a question changed nothing, so it stays on the page.
    if (result.ok) window.location.reload();
  }

  async function edit(event: FormEvent) {
    event.preventDefault();
    const content = prompt.trim();
    if (!content || busy) return;
    setPrompt("");
    await submitTurn(content);
  }

  // Fires once. The ref guards against React's development double-invoke, which
  // would otherwise start two generations and burn two reservations.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    autoStarted.current = true;
    setWorkspaceTab("code");
    void submitTurn(project.original_prompt);
    // submitTurn is stable for this purpose: it only reads state the first run
    // cannot have changed yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  // While streaming, the file tree and editor show what is being written now.
  const streamingFiles = stream.order.map((path) => ({
    path,
    content: stream.drafts[path] ?? "",
  }));
  const showStream = busy || streamingFiles.length > 0;
  const visibleFiles = showStream
    ? streamingFiles
    : files.map((file) => ({ path: file.path, content: file.content }));
  const activePath = stream.activePath ?? selectedFile;
  const currentFile =
    visibleFiles.find((file) => file.path === activePath) ?? visibleFiles[0];
  const buildEntries = Array.isArray(buildLog) ? buildLog : [];

  // On wide screens the builder fills its pane exactly and each column scrolls
  // on its own. That keeps a long conversation from stretching the grid row
  // and, with it, the preview canvas. Below `lg` the columns stack, so normal
  // page scrolling is restored.
  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-5 lg:h-full lg:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 lg:shrink-0">
        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <h1 className="max-w-2xl truncate font-serif text-xl tracking-tight text-ink">
              {project.title}
            </h1>
            {hasVersion ? (
              <>
                <Badge variant="outline">v{versionNumber}</Badge>
                <Badge>可运行</Badge>
              </>
            ) : (
              <Badge variant="outline">没有可运行版本</Badge>
            )}
            <Badge variant="outline">
              {provider === "fake" ? "Fake demo" : "DeepSeek live"}
            </Badge>
          </div>
          <p className="text-xs text-ink-faint">
            改砸了不要紧，上一个能玩的版本一直留着。
          </p>
        </div>
        {hasVersion && (
          <PublishPanel
            projectId={project.id}
            publishedSlug={publishedSlug}
            publishedVisibility={publishedVisibility}
          />
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-accent/25 bg-accent-soft px-4 py-3 text-sm text-accent-hover lg:shrink-0">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex max-h-[70vh] flex-col overflow-hidden rounded-xl border border-line bg-surface lg:max-h-none lg:min-h-0">
          <div className="flex h-11 shrink-0 items-center border-b border-line px-4 text-sm font-medium text-ink">
            对话
            <span className="ml-auto text-xs font-normal text-ink-faint">
              {messages.length} 条
            </span>
          </div>

          <div
            ref={messageScrollRef}
            className="scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
          >
            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === "user"
                    ? "ml-8 rounded-lg rounded-br-sm bg-ink p-3 text-sm leading-6 text-canvas"
                    : "mr-6 rounded-lg rounded-bl-sm border border-line bg-canvas-sunken p-3 text-sm leading-6 text-ink-soft"
                }
              >
                {message.content}
              </div>
            ))}
            {stream.understanding && !stream.questions.length && (
              <div className="mr-6 space-y-2 rounded-lg border border-line bg-canvas-sunken p-3 text-sm leading-6 text-ink-soft">
                <p className="text-ink">{stream.understanding}</p>
                {stream.changes.length > 0 && (
                  <ul className="space-y-1">
                    {stream.changes.map((change) => (
                      <li key={change.path} className="text-xs">
                        <span className="font-mono text-ink">{change.path}</span>
                        <span className="text-ink-faint"> — {change.intent}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {stream.assumptions.length > 0 && (
                  <div className="border-t border-line pt-2 text-xs text-ink-faint">
                    <p>以下几点我自己定了，不合适就直接说：</p>
                    <ul className="mt-1 space-y-0.5">
                      {stream.assumptions.map((assumption) => (
                        <li key={assumption}>· {assumption}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {stream.questions.length > 0 && stream.understanding && (
              <ClarificationPanel
                understanding={stream.understanding}
                questions={stream.questions}
                onAnswer={submitTurn}
              />
            )}

            {busy && (
              <div className="mr-6 flex items-center gap-2 rounded-lg border border-line bg-canvas-sunken p-3 text-sm text-ink-soft">
                <LoaderCircle className="size-4 animate-spin" />
                {stream.connected
                  ? (stream.phaseLabel ?? "正在处理…")
                  : "连接断了，正在重连——生成还在继续"}
                {stream.connected && stream.thinkingChars > 0 && (
                  <span className="ml-auto font-mono text-xs text-ink-faint">
                    已推理 {stream.thinkingChars} 字
                  </span>
                )}
              </div>
            )}
          </div>
          <form onSubmit={edit} className="shrink-0 border-t border-line p-3">
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              disabled={busy}
              placeholder="例如：球速逐渐加快，增加暂停键…"
              className="min-h-24 resize-none"
            />
            <Button
              type="submit"
              className="mt-2 w-full"
              disabled={busy || !prompt.trim()}
            >
              <Send className="size-4" />
              生成新版本
            </Button>
          </form>
        </aside>

        <section className="flex min-h-[520px] flex-col overflow-hidden rounded-xl border border-line bg-surface lg:min-h-0">
          <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-2">
            {(
              [
                ["preview", "预览", Eye],
                ["code", "代码", Code2],
                ["console", "运行信息", SquareTerminal],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                onClick={() => setWorkspaceTab(value)}
                className={`flex h-8 items-center gap-2 rounded-md px-3 text-[13px] transition-colors ${
                  workspaceTab === value
                    ? "bg-canvas-sunken text-ink"
                    : "text-ink-faint hover:text-ink-soft"
                }`}
              >
                <Icon className="size-3.5" />
                {label}
                {value === "code" && (
                  <span className="font-mono text-[10px] text-ink-faint">
                    {visibleFiles.length}
                  </span>
                )}
              </button>
            ))}
            {busy && (
              <span className="ml-auto flex items-center gap-2 pr-2 text-xs text-ink-soft">
                <LoaderCircle className="size-3.5 animate-spin" />
                {stream.phaseLabel ?? "正在生成"}
              </span>
            )}
          </div>

          {workspaceTab === "preview" &&
            (artifactHtml ? (
              <GamePreview artifactHtml={artifactHtml} title={project.title} />
            ) : (
              <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-6">
                <h2 className="font-serif text-lg text-ink">
                  这个作品还没有可运行的版本
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-ink-soft">
                  {failure
                    ? "上一次生成没有完成。原始需求和对话都保留着，修好之后可以直接重试，失败的那次不会重复扣额度。"
                    : "还没有生成过。在左侧描述你想要的东西就可以开始。"}
                </p>

                {failure && (
                  <div className="mt-5 space-y-3">
                    <div className="rounded-lg border border-accent/25 bg-accent-soft px-4 py-3">
                      <p className="text-sm leading-6 text-accent-hover">
                        {failure.message}
                      </p>
                      <p className="mt-1 text-xs text-accent-hover/70">
                        {new Date(failure.at).toLocaleString("zh-CN")}
                        {lastErrorCode ? ` · ${lastErrorCode}` : ""}
                      </p>
                    </div>

                    {failure.detail && (
                      <div>
                        <p className="mb-1.5 text-xs text-ink-faint">详细报错</p>
                        <pre className="scrollbar-thin max-h-64 overflow-auto rounded-lg border border-line bg-canvas-sunken p-3 text-[11px] leading-5 text-ink-soft">
                          <code>{failure.detail}</code>
                        </pre>
                      </div>
                    )}
                  </div>
                )}

                <Button
                  className="mt-6"
                  disabled={busy}
                  onClick={() => submitTurn(project.original_prompt)}
                >
                  {busy ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <RotateCcw className="size-4" />
                  )}
                  {busy ? "正在重试…" : "用原始需求重新生成"}
                </Button>

                <blockquote className="mt-4 rounded-lg border-l-2 border-line-strong bg-canvas-sunken px-4 py-3 text-sm leading-6 text-ink-soft">
                  {project.original_prompt}
                </blockquote>
              </div>
            ))}

          {workspaceTab === "code" && (
            <div className="grid min-h-0 flex-1 md:grid-cols-[220px_minmax(0,1fr)]">
              <div className="scrollbar-thin overflow-auto border-b border-line bg-canvas-sunken p-2 md:border-b-0 md:border-r">
                <p className="px-2 py-2 text-xs font-medium text-ink-faint">
                  {showStream ? "本次改动" : "项目文件"}
                </p>
                {visibleFiles.map((file) => (
                  <button
                    key={file.path}
                    onClick={() => setSelectedFile(file.path)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[11px] transition-colors ${
                      currentFile?.path === file.path
                        ? "bg-surface text-ink"
                        : "text-ink-soft hover:bg-surface/60 hover:text-ink"
                    }`}
                    title={file.path}
                  >
                    <span className="truncate">{file.path}</span>
                    {stream.activePath === file.path && (
                      <span className="ml-auto size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
                    )}
                  </button>
                ))}
              </div>
              <div className="grid min-h-0 grid-rows-[40px_minmax(0,1fr)]">
                <div className="flex items-center border-b border-line px-4 font-mono text-[11px] text-ink-soft">
                  {currentFile?.path ?? "还没有文件"}
                  {currentFile && (
                    <span className="ml-auto text-[10px] text-ink-faint">
                      {currentFile.content.length} chars
                    </span>
                  )}
                </div>
                {currentFile ? (
                  <CodeView
                    path={currentFile.path}
                    code={currentFile.content}
                    streaming={stream.activePath === currentFile.path}
                    className="p-3"
                  />
                ) : (
                  <p className="p-4 text-xs text-ink-faint">
                    等待 Agent 开始写第一个文件…
                  </p>
                )}
              </div>
            </div>
          )}

          {workspaceTab === "console" && (
            <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-5 text-[12px] leading-5">
              <dl className="mb-5 grid gap-3 sm:grid-cols-3">
                {(
                  [
                    [
                      "版本",
                      hasVersion ? `v${versionNumber} runnable` : "无",
                    ],
                    ["文件", `${files.length} 个已保存`],
                    ["生成器", provider ?? "unknown"],
                  ] as const
                ).map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-lg border border-line bg-canvas-sunken p-3"
                  >
                    <dt className="text-xs text-ink-faint">{label}</dt>
                    <dd className="mt-1 font-mono text-ink">{value}</dd>
                  </div>
                ))}
              </dl>

              {busy && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-line bg-canvas-sunken p-3 text-ink-soft">
                  <LoaderCircle className="size-4 animate-spin" />
                  {stream.phaseLabel ?? "请求进行中"}
                  {stream.activePath && (
                    <span className="font-mono text-[11px] text-ink-faint">
                      {stream.activePath}
                    </span>
                  )}
                </div>
              )}

              {stream.logs.length > 0 && (
                <div className="mb-4 space-y-2">
                  {stream.logs.map((message, index) => (
                    <div
                      key={index}
                      className="flex gap-3 rounded-md border border-line px-3 py-2 font-mono"
                    >
                      <span className="text-accent">›</span>
                      <span className="text-ink-soft">{message}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                {buildEntries.length ? (
                  buildEntries.map((entry, index) => (
                    <div
                      key={index}
                      className="flex gap-3 rounded-md border border-line px-3 py-2 font-mono"
                    >
                      <span className="text-accent">✓</span>
                      <span className="text-ink-soft">
                        {buildLogMessage(entry)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="rounded-lg border border-line bg-canvas-sunken p-4 text-ink-faint">
                    当前版本没有保存构建日志。
                  </p>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
