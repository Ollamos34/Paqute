-- ===========================================================
-- MESSENGER APP — FULL MIGRATION
-- ===========================================================
-- Run this ONCE in Supabase SQL Editor (Database → SQL Editor)
-- Idempotent: safe to re-run
-- ===========================================================

-- ===========================================================
-- 1. BASE SCHEMA
-- ===========================================================

-- chats table
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

create policy "chats_read" on public.chats
  for select using (user_a = auth.uid() or user_b = auth.uid());

create policy "chats_write" on public.chats
  for insert with check (user_a = auth.uid() or user_b = auth.uid());

-- messages table
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
drop policy if exists "messages_delete" on public.messages;

create policy "messages_read" on public.messages
  for select using (
    exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

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

-- ===========================================================
-- 2. PROFILES
-- ===========================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  avatar_url text,
  created_at timestamptz not null default now()
);

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

drop policy if exists "profiles_read" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;
drop policy if exists "profiles_insert" on public.profiles;

create policy "profiles_read" on public.profiles
  for select using (auth.role() = 'authenticated');

create policy "profiles_update" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy "profiles_insert" on public.profiles
  for insert with check (id = auth.uid());

-- auto-create profile on signup
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
  base_username := split_part(coalesce(NEW.email, ''), '@', 1);
  base_username := regexp_replace(base_username, '[^A-Za-z0-9_]+', '', 'g');
  base_username := substr(base_username, 1, 24);
  if length(base_username) < 3 then
    base_username := 'user' || substr(NEW.id::text, 1, 8);
  end if;

  final_username := base_username;

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

-- ===========================================================
-- 3. MESSAGES ENHANCEMENTS
-- ===========================================================

-- client_id for deduplication
alter table public.messages
  add column if not exists client_id text,
  add column if not exists deleted_for_everyone boolean not null default false,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists reply_to uuid references public.messages(id) on delete set null;

create unique index if not exists uq_messages_chat_client_id
  on public.messages(chat_id, client_id)
  where client_id is not null;

create index if not exists idx_messages_chat_client_id
  on public.messages(chat_id, client_id);

-- ===========================================================
-- 4. MESSAGE ATTACHMENTS
-- ===========================================================

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  kind text not null check (kind in ('image','video','audio','document','voice','link','note')),
  url text,                     -- legacy public URL field
  storage_path text,            -- bucket-relative path; client re-signs on display
                                -- so attachments keep working regardless of bucket privacy
  file_name text,
  mime_type text,
  size_bytes bigint,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_attachments_message
  on public.message_attachments(message_id);

-- Backfill storage_path for legacy rows whose url points at the
-- `attachments` bucket. Extract the path after `attachments/`.
update public.message_attachments
   set storage_path = split_part(
         split_part(url, '/attachments/', 2),
         '?', 1)
 where storage_path is null
   and url is not null
   and url like '%/attachments/%';

alter table public.message_attachments enable row level security;

drop policy if exists "attachments_read" on public.message_attachments;
drop policy if exists "attachments_write" on public.message_attachments;

create policy "attachments_read" on public.message_attachments for select
  using (
    exists (
      select 1 from public.messages m
      join public.chats c on c.id = m.chat_id
      where m.id = message_attachments.message_id
        and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

create policy "attachments_write" on public.message_attachments for insert
  with check (
    exists (
      select 1 from public.messages m
      where m.id = message_attachments.message_id
        and m.sender_id = auth.uid()
    )
  );

-- ===========================================================
-- 5. SAVED MESSAGES
-- ===========================================================

create table if not exists public.saved_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_chat_id uuid,
  source_message_id uuid,
  kind text not null default 'note'
       check (kind in ('note','link','image','video','document','forward','reminder')),
  text text,
  url text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  meta jsonb default '{}'::jsonb,
  remind_at timestamptz,
  reminded boolean not null default false,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_saved_user_created
  on public.saved_messages(user_id, created_at desc);
create index if not exists idx_saved_user_pin
  on public.saved_messages(user_id, pinned desc, created_at desc);
create index if not exists idx_saved_remind
  on public.saved_messages(user_id, remind_at) where remind_at is not null;

alter table public.saved_messages enable row level security;

drop policy if exists "saved_read" on public.saved_messages;
drop policy if exists "saved_write" on public.saved_messages;
drop policy if exists "saved_update" on public.saved_messages;
drop policy if exists "saved_delete" on public.saved_messages;

create policy "saved_read" on public.saved_messages
  for select using (user_id = auth.uid());
create policy "saved_write" on public.saved_messages
  for insert with check (user_id = auth.uid());
create policy "saved_update" on public.saved_messages
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "saved_delete" on public.saved_messages
  for delete using (user_id = auth.uid());

-- ===========================================================
-- 6. BLOCKED USERS
-- ===========================================================

create table if not exists public.blocked_users (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create index if not exists idx_blocked_blocker
  on public.blocked_users(blocker_id);

alter table public.blocked_users enable row level security;

drop policy if exists "blocked_read" on public.blocked_users;
drop policy if exists "blocked_write" on public.blocked_users;

create policy "blocked_read" on public.blocked_users
  for select using (blocker_id = auth.uid());
create policy "blocked_write" on public.blocked_users
  for all using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- block messaging trigger
create or replace function public.block_message_if_blocked()
returns trigger
language plpgsql
security definer
as $$
declare
  chat_user_a uuid;
  chat_user_b uuid;
  sender_is_blocked boolean;
begin
  select user_a, user_b into chat_user_a, chat_user_b
  from public.chats where id = NEW.chat_id;

  if chat_user_a is null then
    return NEW;
  end if;

  if NEW.sender_id = chat_user_a then
    select exists(
      select 1 from public.blocked_users
      where blocker_id = chat_user_b and blocked_id = chat_user_a
    ) into sender_is_blocked;
  elsif NEW.sender_id = chat_user_b then
    select exists(
      select 1 from public.blocked_users
      where blocker_id = chat_user_a and blocked_id = chat_user_b
    ) into sender_is_blocked;
  end if;

  if sender_is_blocked then
    return null;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_block_message_if_blocked on public.messages;
create trigger trg_block_message_if_blocked
  before insert on public.messages
  for each row execute function public.block_message_if_blocked();

-- ===========================================================
-- 7. CHAT MUTES
-- ===========================================================

create table if not exists public.chat_mutes (
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id uuid not null,
  muted_until timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, chat_id)
);

alter table public.chat_mutes enable row level security;

drop policy if exists "mutes_read" on public.chat_mutes;
drop policy if exists "mutes_write" on public.chat_mutes;

create policy "mutes_read" on public.chat_mutes
  for select using (user_id = auth.uid());
create policy "mutes_write" on public.chat_mutes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ===========================================================
-- 8. CHAT CLEARS
-- ===========================================================

create table if not exists public.chat_clears (
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id uuid not null,
  cleared_at timestamptz not null default now(),
  primary key (user_id, chat_id)
);

create table if not exists public.hidden_chats (
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, profile_id)
);

alter table public.hidden_chats enable row level security;
drop policy if exists "hidden_chats_read" on public.hidden_chats;
drop policy if exists "hidden_chats_write" on public.hidden_chats;
create policy "hidden_chats_read" on public.hidden_chats for select using (user_id = auth.uid());
create policy "hidden_chats_write" on public.hidden_chats for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.chat_clears enable row level security;

drop policy if exists "clears_read" on public.chat_clears;
drop policy if exists "clears_write" on public.chat_clears;

create policy "clears_read" on public.chat_clears
  for select using (user_id = auth.uid());
create policy "clears_write" on public.chat_clears
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ===========================================================
-- 9. GET_OR_CREATE_CHAT RPC
-- ===========================================================
-- Parameter names MUST match the JS client's supabase.rpc() call:
--   supabase.rpc('get_or_create_chat', { user_a, user_b })
-- PostgREST matches RPCs by parameter name, so renaming to
-- p_user_a/p_user_b would break the client with PGRST202.

create or replace function public.get_or_create_chat(user_a uuid, user_b uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  -- IMPORTANT: copy parameter values into locals. The chats table
  -- has columns named user_a and user_b, so referring to the bare
  -- parameter names inside WHERE / VALUES clauses triggers
  -- PL/pgSQL error 42702 ("column reference is ambiguous").
  p_a uuid := user_a;
  p_b uuid := user_b;
  found_id uuid;
  lo uuid;
  hi uuid;
begin
  -- self-chat (Saved Messages)
  if p_a = p_b then
    select c.id into found_id from public.chats c
      where c.user_a = p_a and c.user_b = p_b
      limit 1;
    if found_id is null then
      insert into public.chats (user_a, user_b)
        values (p_a, p_b)
        returning id into found_id;
    end if;
    return found_id;
  end if;

  -- pair chat: order (lo, hi)
  if p_a < p_b then
    lo := p_a; hi := p_b;
  else
    lo := p_b; hi := p_a;
  end if;

  select c.id into found_id from public.chats c
    where (c.user_a = lo and c.user_b = hi)
       or (c.user_a = hi and c.user_b = lo)
    limit 1;

  if found_id is null then
    insert into public.chats (user_a, user_b) values (lo, hi)
      returning id into found_id;
  end if;

  return found_id;
end;
$$;

-- ===========================================================
-- 10. STORAGE BUCKETS
-- ===========================================================

-- avatars bucket
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

drop policy if exists "avatars_read" on storage.objects;
drop policy if exists "avatars_write" on storage.objects;
drop policy if exists "avatars_update" on storage.objects;

create policy "avatars_read" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "avatars_write" on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_update" on storage.objects
  for update using (
    bucket_id = 'avatars'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- attachments bucket. The bucket MUST be public so URLs from
-- getPublicUrl keep working after a page refresh — without a public
-- bucket the static URL 403s and the image disappears. The
-- ON CONFLICT DO UPDATE flips an existing dashboard-created private
-- bucket to public.
insert into storage.buckets (id, name, public)
  values ('attachments', 'attachments', true)
  on conflict (id) do update set public = excluded.public;

drop policy if exists "attachments_storage_read" on storage.objects;
drop policy if exists "attachments_storage_write" on storage.objects;

create policy "attachments_storage_read" on storage.objects
  for select using (bucket_id = 'attachments');

create policy "attachments_storage_write" on storage.objects
  for insert with check (
    bucket_id = 'attachments'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ===========================================================
-- 11. MESSAGE CONTENT COMPATIBILITY
-- The client writes content while the original schema used text.
-- Keep both writable and synchronize them automatically.

alter table public.messages drop column if exists content;
alter table public.messages add column if not exists content text;

update public.messages
set content = text
where content is null;

create or replace function public.sync_message_content()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.content is null then
      NEW.content := coalesce(NEW.text, '');
    else
      NEW.text := NEW.content;
    end if;
  elsif NEW.text is distinct from OLD.text then
    NEW.content := NEW.text;
  elsif NEW.content is distinct from OLD.content then
    NEW.text := NEW.content;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_sync_message_content on public.messages;
create trigger trg_sync_message_content
before insert or update of text, content on public.messages
for each row execute function public.sync_message_content();
-- 12. REALTIME PUBLICATION
-- ===========================================================
-- New tables are NOT in the supabase_realtime publication by default.
-- Without this step the JS Realtime channel subscribes to nothing
-- and the browser cycles reconnect attempts in the console.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'message_attachments'
  ) then
    alter publication supabase_realtime add table public.message_attachments;
  end if;
end$$;

-- ===========================================================
-- DONE
-- ===========================================================
