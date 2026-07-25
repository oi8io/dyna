-- Carry a generation across several requests.
--
-- The whole run used to happen inside one HTTP request, which put it under the
-- platform's per-invocation wall clock. Writing every file in a single model
-- call was also the point where quality fell off: the model had to hold the
-- architecture, the game loop, the rendering and the styling in one context and
-- emit them all at once.
--
-- Splitting it means each request does one thing and finishes quickly, so the
-- strong model can keep its full reasoning budget per file. The state that used
-- to live in local variables now lives on the job row.

alter table public.generation_jobs
  add column plan jsonb,
  -- path -> file content, filled in one step at a time.
  add column draft_files jsonb not null default '{}'::jsonb;

-- `generation_jobs` grants users select only; every write goes through a
-- definer function so a caller cannot forge progress on someone else's job.
create or replace function public.save_generation_plan(
  p_job_id uuid,
  p_plan jsonb
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
  set plan = p_plan
  where id = p_job_id
    and user_id = caller
    and status = 'running';

  if not found then
    raise exception 'job_not_found' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.save_generation_draft(
  p_job_id uuid,
  p_path text,
  p_content text
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
  if p_path is null or p_path = '' then
    raise exception 'invalid_draft_path' using errcode = '22023';
  end if;
  -- The file whitelist is enforced in the application before this is called;
  -- this bound only stops a single draft from bloating the row.
  if octet_length(p_content) > 200000 then
    raise exception 'draft_too_large' using errcode = '22023';
  end if;

  update public.generation_jobs
  set draft_files = coalesce(draft_files, '{}'::jsonb)
    || jsonb_build_object(p_path, p_content)
  where id = p_job_id
    and user_id = caller
    and status = 'running';

  if not found then
    raise exception 'job_not_found' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.save_generation_plan(uuid, jsonb) from public;
revoke all on function public.save_generation_draft(uuid, text, text) from public;
grant execute on function public.save_generation_plan(uuid, jsonb) to authenticated;
grant execute on function public.save_generation_draft(uuid, text, text) to authenticated;
