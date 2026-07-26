import "server-only";

import { z } from "zod";

const optionalPositiveNumber = z
  .string()
  .optional()
  .transform((value) => (value ? Number(value) : undefined))
  .pipe(z.number().positive().optional());

const optionalPositiveInteger = z
  .string()
  .optional()
  .transform((value) => (value ? Number(value) : undefined))
  .pipe(z.number().int().positive().optional());

const serverEnvSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  // No service-role key on purpose. Every database access goes through either
  // the RLS-constrained server client or a SECURITY DEFINER function, so the
  // one credential that could read and delete every user's data never needs to
  // exist in the deployment at all.
  SUPABASE_JWKS_URL: z.url(),
  AI_PROVIDER: z.literal("deepseek").default("deepseek"),
  AI_PROVIDER_MODE: z.enum(["fake", "live"]).default("fake"),
  APP_GENERATION_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  DEEPSEEK_API_KEY: z.string().min(1),
  DEEPSEEK_BASE_URL: z.url().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().default("deepseek-v4-pro"),
  /**
   * Model for the planning stage.
   *
   * Planning is comprehension plus a few hundred tokens of JSON. Running it on
   * the reasoning-heavy model meant paying a full chain-of-thought warm-up for
   * every request — the stage that produces the least output was taking the
   * longest. Flash is roughly a third of the price and has five times the
   * concurrency headroom.
   */
  DEEPSEEK_PLAN_MODEL: z.string().default("deepseek-v4-flash"),
  /**
   * Whether the code-writing stage reasons before answering.
   *
   * Reasoning improves the code but is the single largest contributor to the
   * stage's duration, and the whole generation has to fit inside one
   * serverless invocation. Exposed as a switch so the quality/latency trade
   * can be measured on a real deployment rather than argued about.
   */
  DEEPSEEK_WRITE_THINKING: z
    .enum(["enabled", "disabled"])
    .default("enabled")
    .transform((value) => value === "enabled"),
  DEEPSEEK_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  /**
   * Abort only after this long with no bytes at all.
   *
   * A total timeout cannot tell a stalled request from one that is thinking
   * hard: chain-of-thought arrives as `reasoning_content`, which is real
   * progress even though no answer text has appeared yet.
   */
  DEEPSEEK_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  DEEPSEEK_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .positive()
    .max(65_536)
    .default(16_384),
  APP_PUBLIC_BUDGET_USD: optionalPositiveNumber,
  APP_NEW_USER_CREATE_LIMIT: optionalPositiveInteger,
  APP_NEW_USER_EDIT_LIMIT: optionalPositiveInteger,
  VERCEL_OIDC_TOKEN: z.string().optional(),
  /**
   * Which builder turns generated source into a playable artifact.
   *
   * `sandbox` runs a real install-and-build in a Vercel microVM and only works
   * on Vercel. `local` bundles in-process with esbuild: it never runs the
   * generated code, never installs anything and never executes a build script,
   * so it is the right choice anywhere the microVM is unavailable.
   *
   * Made explicit because it used to be inferred from the presence of a Vercel
   * OIDC token, which silently downgraded the whole app to demo mode the moment
   * it ran anywhere else.
   */
  BUILD_EXECUTOR: z.enum(["sandbox", "local"]).default("local"),
  /**
   * Ceiling for one generation request, in milliseconds.
   *
   * On a serverless host this had to stay under the platform's own limit,
   * because being killed skipped the cleanup that releases the reserved budget.
   * A long-lived process has no such limit, so this is now only a guard against
   * a run that never converges.
   */
  GENERATION_DEADLINE_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(600_000),
  SANDBOX_RUNTIME: z.enum(["node22", "node24"]).default("node22"),
  SANDBOX_VCPUS: z.coerce.number().int().min(1).max(4).default(1),
  SANDBOX_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
});

let cachedEnv: z.infer<typeof serverEnvSchema> | undefined;

export function getServerEnv() {
  cachedEnv ??= serverEnvSchema.parse(process.env);
  return cachedEnv;
}

export function canUseVercelSandbox() {
  const env = getServerEnv();
  if (env.BUILD_EXECUTOR !== "sandbox") return false;
  // Local development receives a short-lived token from `vercel env pull`.
  // On Vercel, the Sandbox SDK obtains the deployment OIDC token from the
  // active request context even though it is not exposed as a runtime env var.
  return Boolean(env.VERCEL_OIDC_TOKEN) || process.env.VERCEL === "1";
}

/**
 * True when a request should really call the model.
 *
 * Deliberately does not ask where it is running. Tying this to a Vercel OIDC
 * token meant that on any other host it quietly returned false and every
 * generation produced the demo fixture instead — no error, no log, just the
 * same breakout game every time.
 */
export function isLiveGenerationReady() {
  const env = getServerEnv();
  return (
    env.APP_GENERATION_ENABLED &&
    env.AI_PROVIDER_MODE === "live" &&
    env.APP_PUBLIC_BUDGET_USD !== undefined &&
    env.APP_NEW_USER_CREATE_LIMIT !== undefined &&
    env.APP_NEW_USER_EDIT_LIMIT !== undefined
  );
}
