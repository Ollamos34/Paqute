-- ===========================================================
-- MESSENGER APP — P0 MIGRATIONS
-- ===========================================================
-- Run once after migrations.sql in Supabase SQL editor.
-- Idempotent.
-- Fixes:
--   P0-1: profiles table + auto-creation trigger on auth signup
--   P0-2: messages.client_id for idempotent sends (prevents dupes
--          when the realtime channel echoes our own optimistic row)
-- ===========================================================

-- 1. profiles -------------------------------------------------
-- One row per user. Created automatically on signup by the
-- trigger below; users can edit username / avatar afterwards.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Username sanity: 3-32 chars, alphanumeric + underscore.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_username_format'
  ) then
    alter table public.profiles
      add constraint profiles_username_format
      check (username is null or username ~ '^[A-Za-z0-9_]{3,32}$');
  end if;
end$$;

create index if not exists idx_profiles_username on public.profiles(username);

alter table public.profiles enable row level security;

drop policy if exists "profiles_read"      on public.profiles;
drop policy if exists "profiles_update"    on public.profiles;
drop policy if exists "profiles_insert"    on public.profiles;

-- Everyone authenticated can read any profile (needed for chat lists).
create policy "profiles_read" on public.profiles
  for select using (auth.role() = 'authenticated');

-- Users can update their own row only.
create policy "profiles_update" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Inserts are performed by the SECURITY DEFINER trigger; allow
-- users to insert their own row as a fallback (e.g. legacy users
-- that signed up before this migration ran).
create policy "profiles_insert" on public.profiles
  for insert with check (id = auth.uid());

-- 2. handle_new_user trigger ----------------------------------
-- Fires on auth.users INSERT. Creates a profiles row with a
-- deterministic username derived from the email local-part
-- (collision-suffixed). Users can change it later.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_username text;
  final_username text;
  suffix int := 0;
begin
  -- Build a base username from the email local-part.
  base_username := split_part(coalesce(NEW.email, ''), '@', 1);
  base_username := regexp_replace(base_username, '[^A-Za-z0-9_]+', '', 'g');
  base_username := substr(base_username, 1, 24);
  if length(base_username) < 3 then
    base_username := 'user' || substr(NEW.id::text, 1, 8);
  end if;

  final_username := base_username;

  -- Disambiguate if the username is already taken.
  while exists(select 1 from public.profiles where username = final_username) loop
    suffix := suffix + 1;
    final_username := base_username || suffix::text;
  end loop;

  insert into public.profiles (id, username)
  values (NEW.id, final_username)
  on conflict (id) do nothing;

  return NEW;
end;
$$;

drop trigger if exists trg_handle_new_user on auth.users;
create trigger trg_handle_new_user
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3. messages.client_id --------------------------------------
-- Lets the client deduplicate its own optimistic inserts when
-- Postgres echoes them back through the realtime channel.
alter table public.messages
  add column if not exists client_id text;

-- 3b. content column alias ------------------------------------
-- The client reads `messages.content`; base schema has `text`.
-- Add a generated column mirroring text so both read paths work.
alter table public.messages
  add column if not exists content text generated always as (text) stored;

-- Unique per chat so the same client_id can be reused across
-- different chats (e.g. after retry) without collision.
create unique index if not exists uq_messages_chat_client_id
  on public.messages(chat_id, client_id)
  where client_id is not null;

create index if not exists idx_messages_chat_client_id
  on public.messages(chat_id, client_id);
