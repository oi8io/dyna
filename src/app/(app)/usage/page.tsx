import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { intlLocale } from "@/lib/i18n/dictionary";
import { getI18n } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getServerEnv, isLiveGenerationReady } from "@/server/env";
import type { Profile } from "@/types/database";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.metadata.usage };
}

interface UsageRow {
  id: string;
  kind: "create" | "edit";
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  charged_credit: number;
  created_at: string;
}

export default async function UsagePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/usage");

  const [{ data: profileData }, { data: ledgerData }] = await Promise.all([
    supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("usage_ledger")
      .select(
        "id, kind, provider, model, input_tokens, output_tokens, charged_credit, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const profile = profileData as Profile | null;
  const ledger = (ledgerData ?? []) as UsageRow[];
  const live = isLiveGenerationReady();
  const env = getServerEnv();

  const { locale, t } = await getI18n();
  const intl = intlLocale(locale);

  const stats = [
    { label: t.usage.createCredits, value: profile?.create_credits ?? 0 },
    { label: t.usage.editCredits, value: profile?.edit_credits ?? 0 },
    { label: t.usage.recordedRuns, value: ledger.length },
  ];

  return (
    <div className="mx-auto max-w-5xl px-5 py-12 lg:px-8">
      <div className="mb-10 border-b border-line pb-8">
        <h1 className="font-serif text-3xl tracking-tight text-ink">
          {t.usage.title}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant={live ? "default" : "outline"}>
            {live ? "Live" : "Safe demo"}
          </Badge>
          <span className="font-mono text-xs text-ink-faint">
            {env.DEEPSEEK_MODEL}
          </span>
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-soft">
          {live ? t.usage.liveNote : t.usage.demoNote}
        </p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl bg-canvas-sunken p-4">
            <dt className="text-[13px] text-ink-soft">{stat.label}</dt>
            <dd className="mt-1 font-mono text-2xl text-ink">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <h2 className="mt-10 font-serif text-xl tracking-tight text-ink">
        {t.usage.recentRuns}
      </h2>
      {ledger.length ? (
        <Card className="mt-4 divide-y divide-line">
          {ledger.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
            >
              <Badge variant="outline">
                {row.kind === "create" ? t.usage.kindCreate : t.usage.kindEdit}
              </Badge>
              <span className="font-mono text-xs text-ink-soft">{row.model}</span>
              <span className="font-mono text-xs text-ink-faint">
                {t.usage.tokens(row.input_tokens + row.output_tokens)}
              </span>
              <span className="ml-auto text-xs text-ink-faint">
                {row.charged_credit ? t.usage.charged : t.usage.notCharged} ·{" "}
                {new Date(row.created_at).toLocaleString(intl)}
              </span>
            </div>
          ))}
        </Card>
      ) : (
        <p className="mt-4 rounded-xl border border-dashed border-line-strong px-5 py-8 text-center text-sm text-ink-soft">
          {t.usage.empty}
        </p>
      )}
    </div>
  );
}
