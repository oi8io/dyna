import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/server/env";
import { redactBuildLog } from "@/server/workspace/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Short on purpose: a reachability probe should fail fast, not hang. */
const PROBE_TIMEOUT_MS = 20_000;

/**
 * Answers one question: can this deployment reach DeepSeek at all?
 *
 * A blocked route and a slow model look identical from the application — both
 * end as an aborted request. This probe separates them by asking for a single
 * token and reporting what actually came back:
 *
 *   - HTTP 200            reachable; any slowness is the model, not the network
 *   - HTTP 401/403        reached the API but the key or the caller's region
 *                         was rejected
 *   - no response at all   the connection never completed, i.e. blocked or
 *                         dropped somewhere in between
 *
 * Requires a session so it is not an open relay for probing someone else's
 * quota, and never returns the key or any header that carries it.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  const env = getServerEnv();
  const endpoint = `${env.DEEPSEEK_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const startedAt = Date.now();

  const base = {
    host: new URL(endpoint).host,
    planModel: env.DEEPSEEK_PLAN_MODEL,
    writeModel: env.DEEPSEEK_MODEL,
    region: process.env.VERCEL_REGION ?? "local",
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.DEEPSEEK_PLAN_MODEL,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        thinking: { type: "disabled" },
      }),
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - startedAt;
    const body = await response.text();

    return NextResponse.json({
      ...base,
      reachable: true,
      status: response.status,
      elapsedMs,
      verdict:
        response.status === 200
          ? "网络通，模型可用。超时是模型本身慢，不是被墙。"
          : response.status === 401 || response.status === 403
            ? "连上了但被拒绝。多半是 Key 无效，或账号归属地与这个出口 IP 不匹配。"
            : `连上了但返回 ${response.status}。`,
      // Truncated and redacted: an error body can echo request details back.
      body: redactBuildLog(body).slice(0, 400),
    });
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    const abortedByTimeout = /abort/i.test(message);

    return NextResponse.json({
      ...base,
      reachable: false,
      elapsedMs,
      verdict: abortedByTimeout
        ? `${PROBE_TIMEOUT_MS / 1000} 秒内没有任何响应。一个 max_tokens=1 的请求不该这么久，基本可以判定这条出口到 DeepSeek 不通。`
        : "连接直接失败，不是超时。",
      error: redactBuildLog(message).slice(0, 400),
    });
  } finally {
    clearTimeout(timer);
  }
}
