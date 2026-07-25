-- Release budget held by generations that never finished.
--
-- `finalize_generation` runs in the route's `finally` block, which does not
-- execute when the serverless function is killed at the platform's wall-clock
-- limit. The job then stays `running` forever and its `reserved_usd` is never
-- returned to `app_budget`.
--
-- With a $10 cap and $0.05 per reservation, ~200 killed requests exhaust the
-- public budget permanently while nothing was actually spent.
--
-- Reaping happens inside `reserve_generation` rather than on a schedule: the
-- only moment the leak matters is when someone tries to reserve, and doing it
-- there needs no cron, no extra credentials and no external worker.

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
      error_code = coalesce(error_code, 'abandoned'),
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

    -- A project left mid-generation would otherwise show "generating" forever.
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

-- Rebuild `reserve_generation` so every reservation first cleans up abandoned
-- ones. Everything below is unchanged apart from the single reap call.
create or replace function public.reserve_generation(
  p_project_id uuid,
  p_kind public.job_kind,
  p_idempotency_key text,
  p_reserved_usd numeric
)
returns public.generation_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  budget public.app_budget%rowtype;
  profile public.profiles%rowtype;
  existing public.generation_jobs%rowtype;
  created public.generation_jobs%rowtype;
begin
  if caller is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if p_reserved_usd <= 0 or p_reserved_usd > 1 then
    raise exception 'invalid_reservation' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.projects
    where id = p_project_id and user_id = caller
  ) then
    raise exception 'project_not_found' using errcode = '42501';
  end if;

  select * into existing
  from public.generation_jobs
  where user_id = caller and idempotency_key = p_idempotency_key;
  if found then
    return existing;
  end if;

  -- The only addition in this revision. It runs after the idempotency
  -- short-circuit so a replayed request still returns its original job.
  perform public.reap_stale_generations();

  if (
    select count(*)
    from public.generation_jobs
    where user_id = caller
      and created_at > now() - interval '1 minute'
  ) >= 2 then
    raise exception 'rate_limit_exceeded' using errcode = 'P0001';
  end if;

  select * into budget
  from public.app_budget
  where singleton = true
  for update;

  if not budget.generation_enabled then
    raise exception 'generation_disabled' using errcode = 'P0001';
  end if;
  if budget.spent_usd + budget.reserved_usd + p_reserved_usd > budget.cap_usd then
    raise exception 'global_budget_exhausted' using errcode = 'P0001';
  end if;

  select * into profile
  from public.profiles
  where user_id = caller
  for update;

  if p_kind = 'create' and profile.create_credits < 1 then
    raise exception 'create_credit_exhausted' using errcode = 'P0001';
  end if;
  if p_kind = 'edit' and profile.edit_credits < 1 then
    raise exception 'edit_credit_exhausted' using errcode = 'P0001';
  end if;

  insert into public.generation_jobs (
    user_id,
    project_id,
    kind,
    idempotency_key,
    reserved_usd,
    status,
    started_at
  )
  values (
    caller,
    p_project_id,
    p_kind,
    p_idempotency_key,
    p_reserved_usd,
    'running',
    now()
  )
  returning * into created;

  update public.app_budget
  set reserved_usd = reserved_usd + p_reserved_usd
  where singleton = true;

  return created;
end;
$$;

revoke all on function public.reserve_generation(uuid, public.job_kind, text, numeric)
  from public;
grant execute on function public.reserve_generation(uuid, public.job_kind, text, numeric)
  to authenticated;
