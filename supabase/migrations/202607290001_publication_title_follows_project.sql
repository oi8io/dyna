-- A publication is named by its project, not by a snapshot of the name.
--
-- `published_games.title` is frozen at publish time. That is right for the
-- artifact — a shared link must keep serving exactly what was published — but
-- wrong for the name, which is how a person recognises the thing. Projects used
-- to be renamed by every edit, so a work published mid-edit ended up called
-- "修复列间距布局" in the gallery and the published list while its own builder
-- called it "蜘蛛纸牌". Reading the name through the project makes the gallery,
-- the published list and the work page agree, and fixes rows already written.
--
-- The column stays: it is the historical record of what the work was called
-- when that particular link was minted.
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
      coalesce(nullif(p.title, ''), g.title) as title,
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

revoke all on function public.list_gallery(integer, integer) from public;
grant execute on function public.list_gallery(integer, integer) to anon, authenticated;

-- The public work page needs the same name, and it reads `published_games`
-- directly rather than through a function. Its RLS policy exposes only active
-- rows, so a companion function keeps the project title readable without
-- opening up `projects` — that table also holds `original_prompt`.
create or replace function public.get_publication_title(p_slug text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(p.title, ''), g.title)
  from public.published_games g
  join public.projects p on p.id = g.project_id
  where g.slug = p_slug
    and g.is_active = true;
$$;

revoke all on function public.get_publication_title(text) from public;
grant execute on function public.get_publication_title(text) to anon, authenticated;
