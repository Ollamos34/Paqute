-- ===========================================================
-- MESSENGER APP — CHAT ACTIONS MIGRATION
-- ===========================================================
-- Run once in Supabase SQL Editor.
-- Supports: delete/hide chat, clear history, mute, block.
-- Idempotent: safe to run more than once.

create table if not exists public.hidden_chats (
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, profile_id)
);

create table if not exists public.chat_mutes (
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id uuid not null references public.chats(id) on delete cascade,
  muted_until timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, chat_id)
);

create table if not exists public.chat_clears (
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id uuid not null references public.chats(id) on delete cascade,
  cleared_at timestamptz not null default now(),
  primary key (user_id, chat_id)
);

create table if not exists public.blocked_users (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocked_users_not_self check (blocker_id <> blocked_id)
);

create index if not exists idx_hidden_chats_user
  on public.hidden_chats(user_id);

create index if not exists idx_chat_mutes_user
  on public.chat_mutes(user_id);

create index if not exists idx_chat_clears_user
  on public.chat_clears(user_id);

create index if not exists idx_blocked_users_blocker
  on public.blocked_users(blocker_id);

alter table public.hidden_chats enable row level security;
alter table public.chat_mutes enable row level security;
alter table public.chat_clears enable row level security;
alter table public.blocked_users enable row level security;

drop policy if exists "hidden_chats_select_own" on public.hidden_chats;
drop policy if exists "hidden_chats_insert_own" on public.hidden_chats;
drop policy if exists "hidden_chats_update_own" on public.hidden_chats;
drop policy if exists "hidden_chats_delete_own" on public.hidden_chats;

create policy "hidden_chats_select_own"
  on public.hidden_chats for select
  using (user_id = auth.uid());

create policy "hidden_chats_insert_own"
  on public.hidden_chats for insert
  with check (user_id = auth.uid());

create policy "hidden_chats_update_own"
  on public.hidden_chats for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "hidden_chats_delete_own"
  on public.hidden_chats for delete
  using (user_id = auth.uid());

drop policy if exists "chat_mutes_select_own" on public.chat_mutes;
drop policy if exists "chat_mutes_insert_own" on public.chat_mutes;
drop policy if exists "chat_mutes_update_own" on public.chat_mutes;
drop policy if exists "chat_mutes_delete_own" on public.chat_mutes;

create policy "chat_mutes_select_own"
  on public.chat_mutes for select
  using (user_id = auth.uid());

create policy "chat_mutes_insert_own"
  on public.chat_mutes for insert
  with check (user_id = auth.uid());

create policy "chat_mutes_update_own"
  on public.chat_mutes for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "chat_mutes_delete_own"
  on public.chat_mutes for delete
  using (user_id = auth.uid());

drop policy if exists "chat_clears_select_own" on public.chat_clears;
drop policy if exists "chat_clears_insert_own" on public.chat_clears;
drop policy if exists "chat_clears_update_own" on public.chat_clears;
drop policy if exists "chat_clears_delete_own" on public.chat_clears;

create policy "chat_clears_select_own"
  on public.chat_clears for select
  using (user_id = auth.uid());

create policy "chat_clears_insert_own"
  on public.chat_clears for insert
  with check (user_id = auth.uid());

create policy "chat_clears_update_own"
  on public.chat_clears for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "chat_clears_delete_own"
  on public.chat_clears for delete
  using (user_id = auth.uid());

drop policy if exists "blocked_users_select_own" on public.blocked_users;
drop policy if exists "blocked_users_insert_own" on public.blocked_users;
drop policy if exists "blocked_users_update_own" on public.blocked_users;
drop policy if exists "blocked_users_delete_own" on public.blocked_users;

create policy "blocked_users_select_own"
  on public.blocked_users for select
  using (blocker_id = auth.uid());

create policy "blocked_users_insert_own"
  on public.blocked_users for insert
  with check (blocker_id = auth.uid());

create policy "blocked_users_update_own"
  on public.blocked_users for update
  using (blocker_id = auth.uid())
  with check (blocker_id = auth.uid());

create policy "blocked_users_delete_own"
  on public.blocked_users for delete
  using (blocker_id = auth.uid());

grant select, insert, update, delete
  on public.hidden_chats, public.chat_mutes, public.chat_clears, public.blocked_users
  to authenticated;