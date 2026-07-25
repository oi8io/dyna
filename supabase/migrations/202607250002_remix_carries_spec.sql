-- Remix inherits the source project's recorded intent.
--
-- SPEC.md already travels for free: it lives inside `source_snapshot`, which
-- remix copies wholesale. What did not travel was `projects.original_prompt` —
-- it was set to the literal string 'Remix of <title>', so the remixer's very
-- first edit ran with no idea what the work was meant to be.
--
-- The spec's goal line is a far better brief than the title, so use it when the
-- snapshot has one.

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
  v_spec text;
  v_goal text;
  v_brief text;
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

  select f.content into v_spec
  from jsonb_to_recordset(v_version.source_snapshot -> 'files')
    as f(path text, content text)
  where f.path = 'SPEC.md';

  -- Pull the paragraph under "## 目标体验" out of the rendered spec.
  if v_spec is not null then
    v_goal := trim(
      split_part(split_part(v_spec, '## 目标体验', 2), '##', 1)
    );
  end if;

  v_brief := coalesce(nullif(v_goal, ''), 'Remix of ' || v_pub.title);

  insert into public.projects (
    user_id, title, original_prompt, status, forked_from
  )
  values (
    v_actor,
    left('Remix of ' || v_pub.title, 120),
    left(v_brief, 4000),
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
    'Remix 自「' || v_pub.title || '」，已带上原作的 SPEC.md。继续对话即可在此基础上修改。',
    jsonb_build_object('remixed_from', v_pub.id)
  );

  return v_new_id;
end;
$$;

revoke all on function public.remix_publication(text) from public;
grant execute on function public.remix_publication(text) to authenticated;
