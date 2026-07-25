# AGENTS.md

This file applies to the entire repository.

## 1. Mission

Build a deployable Atoms-style demo focused on one narrow product:

> A signed-in user describes a lightweight browser game in natural language. An AI Agent generates real frontend code, renders a playable preview, accepts follow-up edits, persists the project, and publishes a public play link.

The demo is a product prototype, not a static mockup and not a general-purpose app builder.

## 2. Current Project State

- Confirmed product requirements exist in `docs/PRD.md`.
- The technical baseline and execution plan exist in `docs/IMPLEMENTATION_PLAN.md`.
- The live task board exists in `docs/TASKS.md`.
- The original challenge is in `docs/【请创建副本后使用】ROOT 全栈岗位笔试.md`.
- The approved direction is:
  - Next.js App Router and TypeScript for the platform;
  - Tailwind and a small shadcn/ui set for product UI;
  - Supabase Auth, PostgreSQL, and RLS;
  - Vercel Sandbox for isolated generated-project checks and builds;
  - a fixed React/TypeScript game template with a locked esbuild pipeline;
  - a provider adapter using DeepSeek `deepseek-v4-pro` through its OpenAI-compatible API in P0.
- Construction has started. Discover exact commands and application status from the repository.
- Supabase, Google OAuth, DeepSeek, and Git resources exist. Sandbox integration is implemented; Vercel linking and a real OIDC smoke test remain pending.

The user explicitly started implementation. Keep `docs/TASKS.md` current while construction proceeds.

## 3. Source of Truth

Resolve conflicts in this order:

1. The user's latest explicit instruction.
2. `docs/PRD.md`.
3. `docs/IMPLEMENTATION_PLAN.md`.
4. `docs/TASKS.md` for current ownership and status only.
5. `docs/【请创建副本后使用】ROOT 全栈岗位笔试.md`.
6. This `AGENTS.md`.

The original challenge document is confidential. Do not publish or reproduce it outside the requested submission workflow.

## 4. Delivery Constraints

- Target focused development time: 6–8 hours.
- Submission window: 48 hours.
- Final output must include:
  - a publicly testable Builder URL;
  - at least one public playable-game URL;
  - a public GitHub source link;
  - a concise README and submission explanation.
- Evaluation emphasizes:
  - completion and stability;
  - engineering judgment and scope control;
  - user experience;
  - originality;
  - deployability and documentation.

Prefer a complete, reliable vertical slice over broad but unfinished functionality.

## 5. Product Scope

### 5.1 Supported

- Lightweight 2D single-player browser games.
- One page or one primary scene.
- Mouse, keyboard, or basic touch interaction.
- DOM, SVG, or Canvas rendering.
- Browser-side game logic.
- Inspectable generated frontend source code.
- Natural-language follow-up edits.
- Persistent projects and conversations.
- Public play links.

Representative games:

- Snake, Breakout, dodging, and clicker games.
- 2048, merging, matching, and memory games.
- Quizzes and reaction games.
- Lightweight board and card games.

Spider Solitaire is a candidate Showcase. It is not a promise that the generator can reliably produce every complex card game.

### 5.2 Explicitly Out of Scope for P0

- General websites, SaaS products, dashboards, or admin systems.
- 3D games, open worlds, large RPGs, or complex physics engines.
- Real-time multiplayer.
- Native mobile or desktop applications.
- AI-generated images, music, speech, or video.
- User-uploaded assets.
- Plugin or template marketplaces.
- GitHub sync, ZIP export, and advanced code editing.
- End-user access to a raw terminal or arbitrary shell.
- Multi-model Race Mode.

Do not add an out-of-scope feature merely because a framework or library makes it easy.

## 6. P0 Product Requirements

### 6.1 Identity and Access

- Support Google sign-in.
- Support verified-email registration and sign-in.
- Support sign-out.
- Guests may browse and play Showcases and public games.
- Guests must not invoke live generation.
- Every private project, conversation, version, and usage record belongs to one authenticated user.
- Enforce ownership on the server for every read, write, publish, and generation action.

### 6.2 Builder Loop

The required end-to-end flow is:

1. Sign in.
2. Enter a one-sentence game request.
3. Pass quota, global-budget, rate, and concurrency checks.
4. Create a project.
5. Show understandable Agent progress.
6. Generate real runnable frontend code.
7. Render the game in an isolated Preview.
8. Let the user play it.
9. Accept a follow-up natural-language edit.
10. Preserve the last runnable version if the edit fails.
11. Persist the project, code, conversation, and usage.
12. Publish a public play URL.

### 6.3 Persistence

At minimum persist:

- users and identities;
- projects and ownership;
- original prompts and follow-up messages;
- current source code;
- current runnable version;
- the previous runnable version;
- publication state and public identifier;
- usage and cost ledger;
- sanitized security events.

Refreshing or reopening a project must restore its code, conversation, and Preview.

### 6.4 Cost and Abuse Protection

- The product uses a server-side LLM API key. Never expose it to the browser or generated game.
- The provider-side key or project has a maximum budget of USD 10.
- Enforce a lower application-level public budget before calling the provider.
- Check user credit and global budget before every generation, edit, retry, or repair.
- Enforce limits on:
  - concurrent jobs;
  - requests per time window;
  - prompt size;
  - output tokens;
  - generation duration;
  - automatic retries.
- One user may run at most one generation job at a time.
- Record request type, model, tokens, estimated cost, charged credit, status, and timestamps in a server-side ledger.
- Credit and cost values displayed by the client are informational; the server is authoritative.
- A global kill switch must stop live generation while leaving Showcases and published games available.
- Use idempotency protection so refreshes and duplicate submissions do not create duplicate jobs or charges.

The following values are proposals, not confirmed decisions:

- USD 8 for public usage, with USD 2 reserved for the final demo and anomalies.
- Three initial generations and five edits per new verified account.
- User-facing generation/edit counts backed by actual token-cost accounting.

Do not hard-code these proposed values until the user confirms them.

### 6.5 Project File Boundary

The product's generation Agent must not receive an open-ended shell.

Generated projects start from the versioned React/TypeScript template defined in `docs/IMPLEMENTATION_PLAN.md`. The platform owns dependencies, build configuration, entrypoints, and CSP shell. The Agent may edit only approved business-source paths.

Expose only project-scoped operations such as:

- list allowed project files;
- read an allowed project file;
- create or update an allowed project file;
- delete an allowed project file when the product flow requires it.

Every operation must:

- authenticate the user;
- authorize project ownership;
- normalize the path on the server;
- reject absolute paths;
- reject parent traversal such as `..`;
- reject symlink escapes;
- reject cross-project paths;
- enforce file count, file size, and total project-size limits.

The generated project must not mount:

- the application repository;
- host filesystem paths;
- environment files;
- credential directories;
- deployment credentials;
- another user's project data.

System prompts are guidance, not a security boundary. Backend checks must reject forbidden operations even if the model requests them.

### 6.6 Generated-Game Isolation

- Run generated games separately from the Builder's trusted origin and state.
- The Preview may execute game scripts but must not receive parent same-origin privileges.
- Generated code must not read Builder cookies, storage, DOM, authentication, environment variables, or secrets.
- Deny external network access by default.
- Deny top-level navigation, popups, and unapproved downloads.
- Validate the source and schema of all Preview/Builder messages.
- Limit message frequency, storage, output size, and resource use.
- A broken or malicious game must not crash the Builder or corrupt project data.

### 6.7 Console and Terminal Policy

P0 does not expose a raw terminal or arbitrary shell to end users.

Provide a read-only Console that may show:

- Agent stages;
- a sanitized file-change summary;
- build status;
- runtime errors;
- automated-check results.

The Console must not expose:

- server absolute paths;
- environment variables;
- access tokens or API keys;
- system prompts;
- raw provider responses;
- other users' identifiers or data.

This restriction applies to the product's end-user experience. Repository development agents may use normal development tools within their authorized workspace.

The product Agent may trigger only fixed internal tasks such as TypeScript checks, Lint, tests, and production build. It cannot supply a command string, working directory, environment variable, package name, or Shell argument.

## 7. UX Invariants

- Guests can immediately play a stable Showcase.
- Live generation clearly asks the guest to sign in.
- The UI always shows remaining credit to a signed-in user.
- Generation displays specific stages rather than an unexplained spinner.
- The playable Preview is the primary result; code is inspectable but secondary.
- A failed edit preserves the last runnable game.
- Errors explain the next action.
- Unsupported requests are reduced honestly:
  - 3D to 2D;
  - multiplayer to single-player or pass-and-play;
  - open world to one level;
  - large RPG to one battle or exploration scene;
  - heavy assets to CSS, geometry, or emoji.
- Do not claim a fallback or pre-generated game was generated live.

## 8. Security Invariants

Treat all of the following as untrusted:

- user prompts;
- LLM output;
- generated HTML, CSS, and JavaScript;
- project file names and paths;
- Preview messages;
- published-game identifiers;
- client-reported credit or cost values.

Required controls:

- server-side authentication and authorization;
- tenant isolation;
- least-privilege Agent tools;
- path normalization and boundary checks;
- output validation before persistence or execution;
- isolated Preview execution;
- server-side quotas and rate limits;
- log redaction;
- secret management outside the client;
- secure defaults when a check fails.

Prompt injection must never grant additional tools, filesystem access, network access, credits, or authorization.

Security-sensitive actions must be enforced by deterministic code, not by asking the LLM whether an action is safe.

## 9. Development Protocol

Before changing code:

1. Read this file and the relevant section of `docs/PRD.md`.
2. Inspect the current repository state and existing changes.
3. Confirm whether the requested item is P0, P1, or out of scope.
4. Identify relevant security and quota invariants.

During implementation:

- Keep changes scoped to the current task.
- Preserve user and other-agent changes.
- Do not silently replace an approved architectural decision.
- Avoid speculative abstractions and unnecessary dependencies.
- Keep secrets out of source, fixtures, logs, screenshots, and client bundles.
- Add server-side checks even when the client already validates the same input.
- Fail closed for authorization, quota, path, and sandbox checks.
- Keep error messages useful without revealing internal paths or secrets.
- Update documentation when behavior or commands change.

After implementation:

- Run the smallest relevant checks first, then broader tests.
- Verify both the happy path and the nearest failure path.
- For security-sensitive work, add or run negative tests.
- Report changed files, commands run, results, known limitations, and remaining decisions.

Do not create commits, push branches, deploy, or mutate external services unless the user explicitly asks.

## 10. Required Acceptance Gates

### 10.1 Functional

- Google sign-in works.
- Verified-email sign-in works.
- Anonymous generation is rejected by the server.
- A reference prompt generates a playable game.
- A follow-up instruction changes the game without losing unrelated behavior.
- Refreshing restores the project.
- Publishing produces a public playable URL.
- A stable Showcase remains available when live generation is disabled.

### 10.2 Cost

- User credit is checked before the provider call.
- Global budget is checked before the provider call.
- Duplicate requests do not duplicate charges.
- Rate and concurrency limits work.
- Usage records reconcile with provider usage closely enough to audit.
- The kill switch stops generation without breaking read-only experiences.

### 10.3 Isolation

- User A cannot access User B's project by guessing an ID.
- Absolute paths are rejected.
- Parent-directory traversal is rejected.
- Symlink escape is rejected if symlinks exist in the chosen design.
- The Agent cannot read environment variables, repository files, or provider credentials.
- Generated code cannot read Builder cookies, storage, DOM, or authentication.
- Generated code cannot navigate the parent or call an unapproved network destination.
- Console output contains no secrets or internal absolute paths.
- The user cannot execute commands through the Console.

### 10.4 Deliverability

- Builder and public game links work in a clean browser session.
- Setup and deployment steps are documented.
- Required environment variables are listed without secret values.
- README records completed scope, omitted scope, tradeoffs, and known limitations.
- Public source and submission links are prepared.

## 11. P1 Priorities

P1 candidates:

- one automatic repair attempt after the P0 TypeScript/build gate fails;
- Preview runtime health checks;
- full version history and rollback;
- generated title and play instructions;
- project rename.

P0 already requires deterministic TypeScript checks and a production build before a version becomes runnable. Lint may report warnings in P0; it is not a release blocker unless the implementation plan is explicitly changed.

## 12. Repository Commands

The stack and package manager have been selected, but the repository has not been scaffolded. Exact commands do not exist yet.

Once technical selection is approved, update this section with exact commands:

```text
Install:
Development:
Build:
Lint:
Unit tests:
Integration tests:
Security tests:
Deployment verification:
```

Do not invent commands. Discover them from the repository after the stack is created.

## 13. Multi-Agent Coordination

- Codex is the primary planner, integrator, security reviewer, and final verifier.
- `docs/TASKS.md` is the operational ownership board.
- External Claude Code or DeepSeek agents may only take tasks marked `READY` and assigned to them.
- A task has one writer. Do not edit another task's allowed paths.
- Shared contracts, root dependencies, lockfiles, migrations, authentication, quota, sandbox, Preview security, provider integration, and deployment remain owned by the primary Agent unless a task explicitly says otherwise.
- External Agents must stop when an interface is missing; they must not invent or replace cross-module contracts.
- External Agents do not create commits, push, deploy, configure credentials, or mutate external services unless the user separately authorizes the action.
- The repository is not yet a Git repository. Do not allow parallel writers in one directory until a Git baseline and isolated worktrees exist.
- Every handoff follows the format below and enters `REVIEW`; only the primary Agent marks it `DONE`.

## 14. Handoff Format

When handing work to another Agent or back to the user, include:

- Outcome.
- Files changed.
- Tests or checks run.
- Security and quota implications.
- Assumptions made.
- Known limitations.
- Remaining decisions or next task.
