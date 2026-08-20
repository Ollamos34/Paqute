-- ===========================================================
-- MESSENGER APP — BASE SCHEMA
-- ===========================================================
-- Run FIRST, before migrations_p0.sql and migrations.sql
-- ===========================================================

-- 1. chats table --------------------------------------------
-- One row per 1:1 conversation. user_a/user_b are ordered
-- (lo, hi) so we can find the chat regardless of who initiated.
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_chats_user_a on public.chats(user_a);
create index if not exists idx_chats_user_b on public.chats(user_b);

alter table public.chats enable row level security;

drop policy if exists "chats_read" on public.chats;
drop policy if exists "chats_write" on public.chats;

-- Users can read chats they're part of
create policy "chats_read" on public.chats
  for select using (user_a = auth.uid() or user_b = auth.uid());

-- Users can create chats with anyone
create policy "chats_write" on public.chats
  for insert with check (user_a = auth.uid() or user_b = auth.uid());

-- 2. messages table -----------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  text text,
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_chat on public.messages(chat_id, created_at desc);
create index if not exists idx_messages_sender on public.messages(sender_id);

alter table public.messages enable row level security;

drop policy if exists "messages_read" on public.messages;
drop policy if exists "messages_write" on public.messages;
drop policy if exists "messages_update" on public.messages;

-- Users can read messages from chats they're in
create policy "messages_read" on public.messages
  for select using (
    exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

-- Users can insert messages into chats they're in
create policy "messages_write" on public.messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

create policy "messages_update" on public.messages
  for update using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

-- 3. get_or_create_chat RPC ---------------------------------
create or replace function public.get_or_create_chat(user_a uuid, user_b uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  found_id uuid;
  lo uuid;
  hi uuid;
begin
  -- self-chat allowed (for "Saved Messages")
  if user_a = user_b then
    select id into found_id from public.chats
      where chats.user_a = get_or_create_chat.user_a
        and chats.user_b = get_or_create_chat.user_b
      limit 1;
    if found_id is null then
      insert into public.chats (user_a, user_b)
        values (get_or_create_chat.user_a, get_or_create_chat.user_b)
        returning id into found_id;
    end if;
    return found_id;
  end if;

  -- pair chat: order by (lo, hi)
  if user_a < user_b then
    lo := user_a; hi := user_b;
  else
    lo := user_b; hi := user_a;
  end if;

  select id into found_id from public.chats
    where (chats.user_a = lo and chats.user_b = hi)
       or (chats.user_a = hi and chats.user_b = lo)
    limit 1;

  if found_id is null then
    insert into public.chats (user_a, user_b) values (lo, hi)
      returning id into found_id;
  end if;

  return found_id;
end;
$$;

-- 4. avatars storage bucket ---------------------------------
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

drop policy if exists "avatars_read" on storage.objects;
drop policy if exists "avatars_write" on storage.objects;

create policy "avatars_read" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "avatars_write" on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
