-- Public gallery, source visibility and remix.
--
-- Model:
--   * A project is private working space. It never appears publicly.
--   * Publishing creates an immutable snapshot in `published_games`. That
--     snapshot is the only thing the public can see or play.
--   * `published_games.visibility` gates SOURCE only:
--       public  -> source readable, remixable
--       private -> playable, but source hidden and remix refused
--
-- Listing and source reads go through SECURITY DEFINER functions rather than
-- broad select policies, because RLS is row-level: opening up `projects` would
-- also expose `original_prompt`, and opening up `project_files` would expose the
-- author's unpublished work-in-progress.

create type public.work_visibility as enum ('public', 'private');

alter table public.published_games
  add column visibility public.work_visibility not null default 'public';

-- A fork points at the exact publication it was cloned from, not at the source
-- project, so attribution survives the author editing on.
alter table public.projects
  add column forked_from uuid references public.published_games(id) on delete set null;

create index published_games_gallery_idx
  on public.published_games (published_at desc)
  where is_active = true;

create index projects_forked_from_idx
  on public.projects (forked_from)
  where forked_from is not null;

-- Gallery listing: the newest active publication per project.
-- Deliberately does not return original_prompt or artifact_html.
create or replace function public.list_gallery(
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  slug text,
  title text,
  author text,
  visibility public.work_visibility,
  is_remix boolean,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select *
  from (
    select distinct on (g.project_id)
      g.slug,
      g.title,
      coalesce(nullif(pr.display_name, ''), '匿名创作者') as author,
      g.visibility,
      p.forked_from is not null as is_remix,
      g.published_at
    from public.published_games g
    join public.projects p on p.id = g.project_id
    left join public.profiles pr on pr.user_id = g.owner_id
    where g.is_active = true
    order by g.project_id, g.published_at desc
  ) latest
  order by latest.published_at desc
  limit least(greatest(coalesce(p_limit, 24), 1), 60)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Source of a publication, read from the frozen version snapshot rather than
-- from `project_files` (which tracks the author's latest, possibly unpublished,
-- edits). Returns nothing for a private publication.
create or replace function public.get_published_source(p_slug text)
returns table (path text, content text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.path, f.content
  from public.published_games g
  join public.project_versions v on v.id = g.version_id
  cross join lateral jsonb_to_recordset(v.source_snapshot -> 'files')
    as f(path text, content text)
  where g.slug = p_slug
    and g.is_active = true
    and g.visibility = 'public'
  order by f.path;
$$;

-- Fork a published snapshot into a new project owned by the caller.
-- Copies the published version's files; does NOT copy the conversation, and
-- does NOT read the author's live project_files.
-- Charges no credits: this performs no model call.
create or replace function public.remix_publication(p_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_pub public.published_games;
  v_version public.project_versions;
  v_new_id uuid;
  v_new_version_id uuid;
begin
  if v_actor is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_pub
  from public.published_games
  where slug = p_slug and is_active = true;

  if not found then
    raise exception 'source_not_remixable';
  end if;

  if v_pub.visibility <> 'public' then
    raise exception 'source_is_private';
  end if;

  select * into v_version
  from public.project_versions
  where id = v_pub.version_id;

  if not found or v_version.source_snapshot -> 'files' is null then
    raise exception 'source_not_remixable';
  end if;

  -- Remix performs no model call and therefore consumes no credits, so it needs
  -- its own abuse guard.
  if (
    select count(*)
    from public.projects
    where user_id = v_actor
      and forked_from is not null
      and created_at > now() - interval '1 hour'
  ) >= 20 then
    raise exception 'remix_rate_limit_exceeded';
  end if;

  insert into public.projects (
    user_id, title, original_prompt, status, forked_from
  )
  values (
    v_actor,
    left('Remix of ' || v_pub.title, 120),
    left('Remix of ' || v_pub.title, 4000),
    'ready',
    v_pub.id
  )
  returning id into v_new_id;

  insert into public.project_versions (
    project_id, version_number, status, source_snapshot, artifact_html, build_log
  )
  values (
    v_new_id,
    1,
    'runnable',
    v_version.source_snapshot,
    v_pub.artifact_html,
    jsonb_build_array(
      jsonb_build_object(
        'level', 'info',
        'message', 'Remix 自已发布的快照 ' || v_pub.slug
      )
    )
  )
  returning id into v_new_version_id;

  update public.projects
  set current_version_id = v_new_version_id
  where id = v_new_id;

  insert into public.project_files (project_id, path, content)
  select v_new_id, f.path, f.content
  from jsonb_to_recordset(v_version.source_snapshot -> 'files')
    as f(path text, content text);

  insert into public.messages (project_id, role, content, metadata)
  values (
    v_new_id,
    'system',
    'Remix 自「' || v_pub.title || '」。继续对话即可在此基础上修改。',
    jsonb_build_object('remixed_from', v_pub.id)
  );

  return v_new_id;
end;
$$;

revoke all on function public.list_gallery(integer, integer) from public;
revoke all on function public.get_published_source(text) from public;
revoke all on function public.remix_publication(text) from public;

grant execute on function public.list_gallery(integer, integer) to anon, authenticated;
grant execute on function public.get_published_source(text) to anon, authenticated;
grant execute on function public.remix_publication(text) to authenticated;
