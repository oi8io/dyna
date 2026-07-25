import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getServerEnv, isLiveGenerationReady } from "@/server/env";
import type { Profile } from "@/types/database";

export const metadata: Metadata = { title: "额度与用量" };

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

  const stats = [
    { label: "新建额度", value: profile?.create_credits ?? 0 },
    { label: "修改额度", value: profile?.edit_credits ?? 0 },
    { label: "已记录的生成", value: ledger.length },
  ];

  return (
    <div className="mx-auto max-w-5xl px-5 py-12 lg:px-8">
      <div className="mb-10 border-b border-line pb-8">
        <h1 className="font-serif text-3xl tracking-tight text-ink">额度与用量</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant={live ? "default" : "outline"}>
            {live ? "Live" : "Safe demo"}
          </Badge>
          <span className="font-mono text-xs text-ink-faint">
            {env.DEEPSEEK_MODEL}
          </span>
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-soft">
          {live
            ? "当前会真实调用模型并扣除额度。停下来向你提问的那一轮不计费。"
            : "当前是零成本演示模式：生成走固定示例工程，不调用模型，也不扣额度。"}
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
        最近的生成
      </h2>
      {ledger.length ? (
        <Card className="mt-4 divide-y divide-line">
          {ledger.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
            >
              <Badge variant="outline">
                {row.kind === "create" ? "新建" : "修改"}
              </Badge>
              <span className="font-mono text-xs text-ink-soft">{row.model}</span>
              <span className="font-mono text-xs text-ink-faint">
                {row.input_tokens + row.output_tokens} tokens
              </span>
              <span className="ml-auto text-xs text-ink-faint">
                {row.charged_credit ? "扣 1 次额度" : "未扣额度"} ·{" "}
                {new Date(row.created_at).toLocaleString("zh-CN")}
              </span>
            </div>
          ))}
        </Card>
      ) : (
        <p className="mt-4 rounded-xl border border-dashed border-line-strong px-5 py-8 text-center text-sm text-ink-soft">
          还没有计费记录。演示模式下的生成不会写入这里。
        </p>
      )}
    </div>
  );
}
