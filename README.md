# Dyna Studio

**English** · [简体中文](README.zh-CN.md)

**Live: <https://dyna.oio.sale>**

Dyna Studio turns one sentence into a real React/TypeScript project. Sign in, describe what you want, play it immediately, keep changing it by talking to it, then publish a public link. The first category is browser games; animation, short-form video, design and web pages come next.

The zero-cost `fake` mode is the default. It still creates projects, stores multi-file source, cuts versions, runs the security checks, renders a playable artifact and publishes snapshots. Switch to `live` and the exact same pipeline calls DeepSeek and really builds the source.


## What works today

**Generation pipeline**

- Create from one sentence, edit in natural language, recover from failure
- A flash model distills the project name at creation time; the name is decoupled from per-version requests, so no later edit ever renames it
- Two-stage generation: plan first, stop and ask when the request is ambiguous (free of charge), write code only after you confirm
- All files are written in a single call, so files can't contradict each other the way per-file writes do
- `SPEC.md` records intent and settled decisions, and travels with versions, publications and remixes
- Edits rewrite only the changed files; a failed build automatically retries once carrying the compiler errors

**Reliability**

- Generation outlives the HTTP connection — closing the browser doesn't kill the job
- SSE reconnects on its own and replays missed events via `Last-Event-ID` instead of regenerating
- Checkpoints per stage (plan / draft / build / publish); a failure resumes from the latest checkpoint
- Context budgeting and compaction, so long conversations don't blow the window
- Leaked credit reservations are reclaimed by `reap_stale_generations`

**Accounts and data**

- Google OAuth (built to Google's own branding spec) and email magic links
- Supabase model for projects, messages, source, versions, usage and publication snapshots
- Ownership isolation through RLS

**Build and security**

- In-process esbuild builder (optional Sandbox microVM on Vercel)
- File allowlist, path-traversal protection, size and remote-asset limits
- Atomic credit reservation, idempotency, a global budget, concurrency and rate limits
- Preview isolated in `iframe sandbox="allow-scripts"`
- CSP, log redaction and open-redirect protection

**Publishing and sharing**

- Immutable public play links that stay valid forever once published
- The home gallery shows published work only; unpublished projects stay fully private
- One-click remix copies the snapshot as published, not the author's current version
- Remixing can be allowed or denied at publish time, and revoked later

## Stack

Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn-style components, shiki, Supabase, DeepSeek, Vitest and esbuild, deployed on a long-lived Node process on Railway.

Generation streams over SSE: every chunk the model writes shows up in the Builder's read-only editor, which follows along to whichever file is being written.

## Roadmap

Four things, and they form a causal chain rather than four parallel features:

```
More categories   animation / short video / design / web, plus a category concept
   ↓              more categories means more compute demand
Worker queue      generation is scheduled instead of started on arrival
   ↓              once there's a queue, "skip the queue" is something you can sell
Pro / Plus plans  paying users are scheduled first
   ↓              demand beyond what a plan covers
Credits & top-up  billed against real token consumption
```

**The queue isn't a performance optimization. It's the precondition for the business model.**

**More categories.** The engine never assumed the artifact is a game — the checkpoint state machine, SSE reconnection, context compaction, build, credits, CSP isolation, publishing and remix are all category-agnostic. Only four things are coupled to games: the project skeleton, the writable-path allowlist, the domain vocabulary in the prompt, and the artifact self-check probe. So the way to extend is **to add a recipe, not a branch**: each category is a `Recipe` declaring its own template, allowlist, domain prompt fragment and success criteria, with zero engine changes. The category is decided by the same flash call that distills the name, can be overridden by the user, and — like the name — is fixed at creation and never changes across versions.

**Worker queue.** Today generation starts on arrival with no concurrency control. The plan is a Postgres queue using `FOR UPDATE SKIP LOCKED` rather than introducing Redis — checkpoints and credit reservations already live in that same database, and an external queue would split off a second source of truth. A lease mechanism lets a crashed worker's job return to the queue, and whoever picks it up resumes from the checkpoint instead of starting over.

**Plans and credits.** Priority *is* the plan, with aging so free users don't starve — what you buy is a shorter wait, not an indefinite cut in line. Credits move from "number of runs" to "actual token consumption", and `generation_jobs` already carries `input_tokens` / `output_tokens` / `reserved_usd` / `final_usd`, so what changes is the unit of pricing, not the billing architecture.

Known hard part: success criteria are much weaker outside games — a poster with bad composition and an animation with bad pacing both pass a build check. Until that's solved, new categories won't be marked as supported.


## Running locally

Requires Node.js 22+ and pnpm 9+.

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open `http://localhost:3000`. Every variable is documented in `.env.example`; real secrets belong only in `.env.local` or your host's server-side environment.

## Supabase setup

The schema lives in `supabase/migrations/` and all of it must be applied, in order:

| Migration | Purpose |
| --- | --- |
| `202607240001_initial_schema` | Core model, RLS, credit RPCs |
| `202607250001_visibility_and_remix` | Visibility, gallery and remix |
| `202607250002_remix_carries_spec` | Remix inherits intent from the publication snapshot |
| `202607250003_reap_stale_generations` | Reclaims credits leaked by dead jobs |
| `202607250004_split_generation_steps` | Plan and draft persist separately |
| `202607250005_resumable_generations` | Generation becomes a resumable checkpoint state machine |

```bash
pnpm dlx supabase link --project-ref <project-ref>
pnpm dlx supabase db push --dry-run
pnpm dlx supabase db push
```

After migrating, set your confirmed limits in the SQL Editor. Every placeholder below must be replaced:

```sql
update public.app_budget
set
  generation_enabled = true,
  cap_usd = <PUBLIC_BUDGET_USD>,
  default_create_credits = <CREATE_LIMIT>,
  default_edit_credits = <EDIT_LIMIT>
where singleton = true;
```

`APP_PUBLIC_BUDGET_USD`, `APP_NEW_USER_CREATE_LIMIT` and `APP_NEW_USER_EDIT_LIMIT` in your environment must carry the same values. Google sign-in additionally needs an OAuth client configured under Supabase Auth Providers, with both your local and production `/auth/callback` URLs added to the redirect list.

## Generation modes

Safe defaults:

```text
AI_PROVIDER_MODE=fake
APP_GENERATION_ENABLED=false
```

Live mode turns on only when all of the following hold:

- `AI_PROVIDER_MODE=live` and `APP_GENERATION_ENABLED=true`
- All three budget/credit environment variables are positive
- A DeepSeek key is configured
- `app_budget.generation_enabled=true` in the database

The builder is selected by `BUILD_EXECUTOR`: `local` uses in-process esbuild and runs on any host, `sandbox` uses a Vercel microVM and is Vercel-only.

## Security model

- The agent may only write `src/App.tsx`, `src/styles.css`, `src/game/**`, `src/components/game/**` and `README.md`.
- Dependencies, entry point, build scripts, CSP and TypeScript config are locked by the platform.
- The sandbox installs pinned dependencies, then drops the network before building, and never receives production secrets.
- Preview gets scripts only — no same-origin, no navigation, no popups, no downloads.
- Generated HTML must pass a strict CSP and a remote-asset scan.
- The product never exposes a terminal to users.

## Verification

```bash
pnpm check
```

This runs TypeScript, ESLint, Vitest and a production build. Tests cover path traversal, template escape, CSP bypass, remote assets, open redirects, and compilation of the fake project's source.

## Layout

```text
src/app/                 Pages and Route Handlers
src/app/(app)/           Signed-in workspace (shared sidebar)
src/components/layout/   App shell, sidebar and user card
src/components/builder/  Builder, Preview, recovery states
src/server/llm/          Fake/DeepSeek providers and prompts
src/server/generation/   Checkpoint state machine, run registry, SSE stream
src/server/template/     Locked game project template
src/server/workspace/    File boundaries and log redaction
src/server/build/        Inline/Sandbox builders
supabase/migrations/     Schema, RLS, credit RPCs
```

## External setup required to deploy your own

The code runs out of the box — `fake` mode needs no keys at all. Running `live` requires work in the respective consoles:

- Apply every migration under `supabase/migrations/`
- Configure the Google OAuth client and redirect URLs in Supabase Auth
- Set the public budget and new-user credits in the SQL Editor
- Configure environment variables and bind a domain on your host

The repository will not assume default limits or deploy anything on your behalf — budgets and keys belong to real external projects, and the person deploying has to confirm them explicitly.
