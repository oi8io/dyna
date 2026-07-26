-- Make a generation resumable from wherever it stopped.
--
-- A run was previously one indivisible attempt: plan, write, build, save. A
-- failure at the build step discarded a finished plan and a finished set of
-- files, and the retry paid for both again — and produced different code, so
-- "retry" also meant "start over with a different game".
--
-- Each stage now commits its output before the next begins. Re-entering a run
-- resumes at the first unfinished stage, and the state at any checkpoint is
-- readable rather than trapped in a process.

create type public.generation_stage as enum (
  'planning',
  'writing',
  'building',
  'saving',
  'succeeded',
  'failed'
);

alter table public.generation_jobs
  add column stage public.generation_stage not null default 'planning',
  -- Survives across attempts, so a repair sees what the last one produced.
  add column attempts integer not null default 0,
  add column last_error text,
  -- The built artifact, kept so a failure after building does not rebuild.
  add column draft_artifact_html text;

create index generation_jobs_resumable_idx
  on public.generation_jobs (project_id, created_at desc)
  where stage not in ('succeeded', 'failed');

/**
 * Advances a run and records what that stage produced.
 *
 * One function rather than one per stage: the checkpoint and the stage
 * transition have to be the same write, or a crash between them leaves a run
 * claiming to have finished work whose output was never stored.
 */
create or replace function public.checkpoint_generation(
  p_job_id uuid,
  p_stage public.generation_stage,
  p_plan jsonb default null,
  p_draft_files jsonb default null,
  p_artifact_html text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  update public.generation_jobs
  set
    stage = p_stage,
    -- Each payload is optional: a stage only overwrites what it produced.
    plan = coalesce(p_plan, plan),
    draft_files = coalesce(p_draft_files, draft_files),
    draft_artifact_html = coalesce(p_artifact_html, draft_artifact_html),
    last_error = case when p_error is null then last_error else p_error end,
    attempts = case when p_error is null then attempts else attempts + 1 end
  where id = p_job_id
    and user_id = caller
    and stage not in ('succeeded', 'failed');

  if not found then
    raise exception 'job_not_resumable' using errcode = '42501';
  end if;
end;
$$;

/**
 * The most recent run for a project that still has work left in it.
 *
 * Returned to the caller so the UI can offer to continue rather than restart,
 * and so a retry knows which checkpoint it is resuming from.
 */
create or replace function public.find_resumable_generation(p_project_id uuid)
returns table (
  id uuid,
  stage public.generation_stage,
  kind public.job_kind,
  attempts integer,
  last_error text,
  has_plan boolean,
  file_count integer,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    j.id,
    j.stage,
    j.kind,
    j.attempts,
    j.last_error,
    j.plan is not null as has_plan,
    (select count(*)::integer from jsonb_object_keys(j.draft_files)) as file_count,
    j.created_at
  from public.generation_jobs j
  where j.project_id = p_project_id
    and j.user_id = (select auth.uid())
    and j.stage not in ('succeeded', 'failed')
  order by j.created_at desc
  limit 1;
$$;

revoke all on function public.checkpoint_generation(
  uuid, public.generation_stage, jsonb, jsonb, text, text
) from public;
revoke all on function public.find_resumable_generation(uuid) from public;
grant execute on function public.checkpoint_generation(
  uuid, public.generation_stage, jsonb, jsonb, text, text
) to authenticated;
grant execute on function public.find_resumable_generation(uuid) to authenticated;

-- The reaper marks abandoned runs failed. Keep that in step with the new
-- stage column so a reaped run is not offered as resumable forever.
create or replace function public.reap_stale_generations(
  p_timeout interval default interval '10 minutes'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  released numeric := 0;
  reaped integer := 0;
begin
  with stale as (
    update public.generation_jobs
    set
      status = 'failed',
      stage = 'failed',
      error_code = coalesce(error_code, 'abandoned'),
      last_error = coalesce(last_error, '任务超时未完成，已自动结束。'),
      final_usd = coalesce(final_usd, 0),
      completed_at = now()
    where status in ('queued', 'running')
      and coalesce(started_at, created_at) < now() - p_timeout
    returning reserved_usd
  )
  select coalesce(sum(reserved_usd), 0), count(*) into released, reaped
  from stale;

  if reaped > 0 then
    update public.app_budget
    set reserved_usd = greatest(0, reserved_usd - released)
    where singleton = true;

    update public.projects p
    set status = case when p.current_version_id is null then 'failed' else 'ready' end
    where p.status = 'generating'
      and not exists (
        select 1 from public.generation_jobs j
        where j.project_id = p.id and j.status in ('queued', 'running')
      );
  end if;

  return reaped;
end;
$$;

revoke all on function public.reap_stale_generations(interval) from public;
grant execute on function public.reap_stale_generations(interval) to authenticated;
