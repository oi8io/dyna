create extension if not exists pgcrypto with schema extensions;

create type public.project_status as enum (
  'draft',
  'generating',
  'ready',
  'failed',
  'archived'
);

create type public.job_kind as enum ('create', 'edit');
create type public.job_status as enum (
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled'
);
create type public.version_status as enum ('draft', 'runnable', 'failed');
create type public.message_role as enum ('user', 'assistant', 'system');

create table public.app_budget (
  singleton boolean primary key default true check (singleton),
  generation_enabled boolean not null default false,
  cap_usd numeric(12, 6) not null default 0 check (cap_usd >= 0),
  reserved_usd numeric(12, 6) not null default 0 check (reserved_usd >= 0),
  spent_usd numeric(12, 6) not null default 0 check (spent_usd >= 0),
  default_create_credits integer not null default 0 check (default_create_credits >= 0),
  default_edit_credits integer not null default 0 check (default_edit_credits >= 0),
  updated_at timestamptz not null default now()
);

insert into public.app_budget (singleton) values (true);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  create_credits integer not null default 0 check (create_credits >= 0),
  edit_credits integer not null default 0 check (edit_credits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  original_prompt text not null check (char_length(original_prompt) between 1 and 4000),
  status public.project_status not null default 'draft',
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_user_updated_idx
  on public.projects(user_id, updated_at desc);

create table public.project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  status public.version_status not null default 'draft',
  source_snapshot jsonb not null default '{}'::jsonb,
  artifact_html text,
  build_log jsonb not null default '[]'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  unique(project_id, version_number)
);

alter table public.projects
  add constraint projects_current_version_fk
  foreign key (current_version_id)
  references public.project_versions(id)
  on delete set null;

create table public.project_files (
  project_id uuid not null references public.projects(id) on delete cascade,
  path text not null check (
    char_length(path) between 1 and 240
    and path !~ '(^/|(^|/)\.\.(/|$)|\\)'
  ),
  content text not null,
  byte_size integer generated always as (octet_length(content)) stored,
  updated_at timestamptz not null default now(),
  primary key(project_id, path),
  check (octet_length(content) <= 200000)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  role public.message_role not null,
  content text not null check (char_length(content) between 1 and 20000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index messages_project_created_idx
  on public.messages(project_id, created_at);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  kind public.job_kind not null,
  status public.job_status not null default 'queued',
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 120),
  reserved_usd numeric(12, 6) not null default 0 check (reserved_usd >= 0),
  final_usd numeric(12, 6) check (final_usd >= 0),
  provider text,
  model text,
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, idempotency_key)
);

create unique index generation_jobs_one_active_per_user_idx
  on public.generation_jobs(user_id)
  where status in ('queued', 'running');

create table public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  job_id uuid not null unique references public.generation_jobs(id) on delete cascade,
  kind public.job_kind not null,
  provider text not null,
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  estimated_cost_usd numeric(12, 6) not null default 0 check (estimated_cost_usd >= 0),
  charged_credit integer not null default 0 check (charged_credit in (0, 1)),
  created_at timestamptz not null default now()
);

create index usage_ledger_user_created_idx
  on public.usage_ledger(user_id, created_at desc);

create table public.published_games (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  version_id uuid not null references public.project_versions(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{5,47}$'),
  title text not null check (char_length(title) between 1 and 120),
  artifact_html text not null,
  is_active boolean not null default true,
  published_at timestamptz not null default now()
);

create table public.security_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  event_type text not null check (char_length(event_type) between 1 and 80),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

create trigger projects_set_updated_at
before update on public.projects
for each row execute procedure public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  budget public.app_budget%rowtype;
begin
  select * into budget from public.app_budget where singleton = true;
  insert into public.profiles (
    user_id,
    display_name,
    avatar_url,
    create_credits,
    edit_credits
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(budget.default_create_credits, 0),
    coalesce(budget.default_edit_credits, 0)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- OAuth may be configured before the application schema is installed. Backfill
-- those existing Auth users so they have the same profile as future sign-ups.
insert into public.profiles (
  user_id,
  display_name,
  avatar_url,
  create_credits,
  edit_credits
)
select
  users.id,
  coalesce(
    users.raw_user_meta_data ->> 'full_name',
    split_part(users.email, '@', 1)
  ),
  users.raw_user_meta_data ->> 'avatar_url',
  budget.default_create_credits,
  budget.default_edit_credits
from auth.users as users
cross join public.app_budget as budget
where budget.singleton = true
on conflict (user_id) do nothing;

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

create or replace function public.finalize_generation(
  p_job_id uuid,
  p_status public.job_status,
  p_final_usd numeric,
  p_provider text,
  p_model text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  job public.generation_jobs%rowtype;
  charge integer := 0;
begin
  if caller is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'invalid_final_status' using errcode = '22023';
  end if;
  if p_final_usd < 0 then
    raise exception 'invalid_final_cost' using errcode = '22023';
  end if;

  select * into job
  from public.generation_jobs
  where id = p_job_id and user_id = caller
  for update;

  if not found then
    raise exception 'job_not_found' using errcode = '42501';
  end if;
  if job.status in ('succeeded', 'failed', 'cancelled') then
    return;
  end if;

  if p_status = 'succeeded' then
    charge := 1;
  end if;

  update public.generation_jobs
  set
    status = p_status,
    final_usd = p_final_usd,
    provider = p_provider,
    model = p_model,
    input_tokens = greatest(p_input_tokens, 0),
    output_tokens = greatest(p_output_tokens, 0),
    error_code = p_error_code,
    completed_at = now()
  where id = job.id;

  update public.app_budget
  set
    reserved_usd = greatest(0, reserved_usd - job.reserved_usd),
    spent_usd = spent_usd + p_final_usd
  where singleton = true;

  if charge = 1 then
    update public.profiles
    set
      create_credits = case
        when job.kind = 'create' then greatest(0, create_credits - 1)
        else create_credits
      end,
      edit_credits = case
        when job.kind = 'edit' then greatest(0, edit_credits - 1)
        else edit_credits
      end
    where user_id = caller;

    insert into public.usage_ledger (
      user_id,
      project_id,
      job_id,
      kind,
      provider,
      model,
      input_tokens,
      output_tokens,
      estimated_cost_usd,
      charged_credit
    )
    values (
      caller,
      job.project_id,
      job.id,
      job.kind,
      p_provider,
      p_model,
      greatest(p_input_tokens, 0),
      greatest(p_output_tokens, 0),
      p_final_usd,
      charge
    )
    on conflict (job_id) do nothing;
  end if;
end;
$$;

alter table public.app_budget enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_versions enable row level security;
alter table public.project_files enable row level security;
alter table public.messages enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.published_games enable row level security;
alter table public.security_events enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using ((select auth.uid()) = user_id);
create policy "profiles_update_own"
  on public.profiles for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "projects_owner_all"
  on public.projects for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "versions_owner_all"
  on public.project_versions for all
  using (exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = (select auth.uid())
  ));

create policy "files_owner_all"
  on public.project_files for all
  using (exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = (select auth.uid())
  ));

create policy "messages_owner_all"
  on public.messages for all
  using (exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = (select auth.uid())
  ));

create policy "jobs_select_own"
  on public.generation_jobs for select
  using ((select auth.uid()) = user_id);

create policy "usage_select_own"
  on public.usage_ledger for select
  using ((select auth.uid()) = user_id);

create policy "published_public_read"
  on public.published_games for select
  using (is_active = true or owner_id = (select auth.uid()));
create policy "published_owner_insert"
  on public.published_games for insert
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.user_id = (select auth.uid())
    )
  );
create policy "published_owner_update"
  on public.published_games for update
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "published_owner_delete"
  on public.published_games for delete
  using (owner_id = (select auth.uid()));

revoke all on public.app_budget from anon, authenticated;
revoke all on public.security_events from anon, authenticated;
revoke all on function public.reserve_generation(uuid, public.job_kind, text, numeric)
  from public;
revoke all on function public.finalize_generation(
  uuid,
  public.job_status,
  numeric,
  text,
  text,
  integer,
  integer,
  text
) from public;
grant execute on function public.reserve_generation(uuid, public.job_kind, text, numeric)
  to authenticated;
grant execute on function public.finalize_generation(
  uuid,
  public.job_status,
  numeric,
  text,
  text,
  integer,
  integer,
  text
) to authenticated;
