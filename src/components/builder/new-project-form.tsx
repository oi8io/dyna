"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n/client";
import { translateError } from "@/lib/i18n/dictionary";
import { useSeededPrompt } from "@/lib/i18n/use-seeded-prompt";

export function NewProjectForm({ initialPrompt }: { initialPrompt?: string }) {
  const t = useT();
  const router = useRouter();
  const {
    value: prompt,
    setValue: setPrompt,
    seeds: examples,
  } = useSeededPrompt("newProject", initialPrompt);
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string>();

  /**
   * Creates the project and hands off immediately.
   *
   * Generation used to run here, which meant staring at this form for the
   * couple of minutes a two-stage run takes, and only reaching the editor once
   * everything was already finished. The builder starts the run itself, so the
   * code appears as it is written.
   */
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrorCode(undefined);

    try {
      const createResponse = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const created = (await createResponse.json()) as {
        projectId?: string;
        code?: string;
      };
      if (!createResponse.ok || !created.projectId) {
        setErrorCode(created.code ?? "project_create_failed");
        setBusy(false);
        return;
      }

      router.push(`/builder/${created.projectId}`);
    } catch {
      // A thrown fetch is the network, not the API: there is no code to read.
      setErrorCode("unknown");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="overflow-hidden rounded-xl border border-line-strong bg-surface">
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          disabled={busy}
          maxLength={4000}
          className="min-h-40 resize-none rounded-none border-0 bg-transparent p-5 text-[15px] leading-7 focus:border-0"
          placeholder={t.newProject.placeholder}
        />
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
          <span className="truncate font-mono text-xs text-ink-faint">
            {busy ? t.newProject.opening : `${prompt.length}/4000`}
          </span>
          <Button type="submit" disabled={busy || prompt.trim().length < 8}>
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            {busy ? t.newProject.openingShort : t.newProject.start}
            {!busy && <ArrowRight className="size-4" />}
          </Button>
        </div>
      </div>

      {errorCode && (
        <p
          role="alert"
          className="rounded-lg border border-accent/25 bg-accent-soft px-4 py-3 text-sm text-accent-hover"
        >
          {translateError(t, errorCode)}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {examples.map((example) => (
          <button
            key={example}
            type="button"
            disabled={busy}
            onClick={() => setPrompt(example)}
            className="rounded-full border border-line bg-canvas-sunken px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
          >
            {example.length > 18 ? `${example.slice(0, 18)}…` : example}
          </button>
        ))}
      </div>
    </form>
  );
}
