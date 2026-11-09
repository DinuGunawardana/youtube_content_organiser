-- Content Organiser: private per-user cloud library
-- Run this entire script once in Supabase SQL Editor.

create table if not exists public.content_organiser_library (
  user_id uuid primary key references auth.users(id) on delete cascade,
  categories jsonb not null default '[]'::jsonb,
  videos jsonb not null default '[]'::jsonb,
  import_logs jsonb not null default '[]'::jsonb,
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  constraint content_organiser_categories_array check (jsonb_typeof(categories) = 'array'),
  constraint content_organiser_videos_array check (jsonb_typeof(videos) = 'array'),
  constraint content_organiser_import_logs_array check (jsonb_typeof(import_logs) = 'array')
);

alter table public.content_organiser_library enable row level security;

drop policy if exists "Users can read their own Content Organiser library"
  on public.content_organiser_library;

create policy "Users can read their own Content Organiser library"
  on public.content_organiser_library
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Writes are performed only through the revision-checked RPC below.
revoke insert, update, delete on public.content_organiser_library from anon, authenticated;
grant select on public.content_organiser_library to authenticated;

create or replace function public.save_content_organiser_library(
  p_categories jsonb,
  p_videos jsonb,
  p_import_logs jsonb,
  p_expected_revision integer
)
returns setof public.content_organiser_library
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if jsonb_typeof(p_categories) <> 'array'
     or jsonb_typeof(p_videos) <> 'array'
     or jsonb_typeof(p_import_logs) <> 'array' then
    raise exception 'INVALID_LIBRARY_PAYLOAD';
  end if;

  return query
  insert into public.content_organiser_library
    (user_id, categories, videos, import_logs, revision, updated_at)
  values
    (v_user_id, p_categories, p_videos, p_import_logs, 1, now())
  on conflict (user_id) do update
    set categories = excluded.categories,
        videos = excluded.videos,
        import_logs = excluded.import_logs,
        revision = public.content_organiser_library.revision + 1,
        updated_at = now()
    where public.content_organiser_library.revision = p_expected_revision
  returning *;

  if not found then
    raise exception 'REVISION_CONFLICT';
  end if;
end;
$$;

revoke all on function public.save_content_organiser_library(jsonb, jsonb, jsonb, integer) from public;
grant execute on function public.save_content_organiser_library(jsonb, jsonb, jsonb, integer) to authenticated;

-- Enable Postgres Changes so other signed-in devices receive updates.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'content_organiser_library'
  ) then
    alter publication supabase_realtime
      add table public.content_organiser_library;
  end if;
end $$;

alter table public.content_organiser_library replica identity full;
