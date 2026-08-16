-- ===========================================================
-- MESSENGER APP — DB MIGRATIONS
-- ===========================================================
-- Run this once in Supabase SQL editor (Database → SQL Editor).
-- Idempotent: safe to re-run; uses IF NOT EXISTS where possible.
-- ===========================================================

-- 1. message_attachments ------------------------------------
-- Files / images / videos / documents / voice attached to a message.
create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  kind text not null check (kind in ('image','video','audio','document','voice','link','note')),
  url text,                     -- public/supabase url for files
  file_name text,
  mime_type text,
  size_bytes bigint,
  meta jsonb default '{}'::jsonb,  -- e.g. {"duration":12} for voice
  created_at timestamptz not null default now()
);
create index if not exists idx_attachments_message
  on public.message_attachments(message_id);

-- 2. saved_messages ----------------------------------------
-- Telegram-style "Saved Messages" — private notes per user.
-- Each row is a saved/forwarded item; users can have many.
create table if not exists public.saved_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- optional link back to the source (for forwarded items)
  source_chat_id uuid,
  source_message_id uuid,
  -- content
  kind text not null default 'note'
       check (kind in ('note','link','image','video','document','forward','reminder')),
  text text,
  url text,                 -- for links/files
  file_name text,
  mime_type text,
  size_bytes bigint,
  meta jsonb default '{}'::jsonb,   -- {"due_at":"..."} for reminders, etc.
  -- remind_at drives the in-app reminder banner
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

-- 3. blocked_users -----------------------------------------
-- Per-user block list. Once blocked, messages from B→A are dropped.
create table if not exists public.blocked_users (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
create index if not exists idx_blocked_blocker
  on public.blocked_users(blocker_id);

-- 4. chat_mutes --------------------------------------------
create table if not exists public.chat_mutes (
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id uuid not null,
  muted_until timestamptz,    -- null = forever
  created_at timestamptz not null default now(),
  primary key (user_id, chat_id)
);

-- 5. chat_clears -------------------------------------------
-- When a user clears a chat, hide all messages >= cleared_at for them.
create table if not exists public.chat_clears (
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id uuid not null,
  cleared_at timestamptz not null default now(),
  primary key (user_id, chat_id)
);

-- 6. messages: harden --------------------------------------
-- add deleted_for_everyone flag so a sender can recall a message
alter table public.messages
  add column if not exists deleted_for_everyone boolean not null default false,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists reply_to uuid references public.messages(id) on delete set null;

-- 7. RLS ----------------------------------------------------
-- Enable RLS on new tables and allow owner-only access.
alter table public.message_attachments enable row level security;
alter table public.saved_messages enable row level security;
alter table public.blocked_users enable row level security;
alter table public.chat_mutes enable row level security;
alter table public.chat_clears enable row level security;

-- Drop existing policies (idempotent)
drop policy if exists "attachments_read"  on public.message_attachments;
drop policy if exists "attachments_write" on public.message_attachments;
drop policy if exists "saved_read"        on public.saved_messages;
drop policy if exists "saved_write"       on public.saved_messages;
drop policy if exists "saved_delete"      on public.saved_messages;
drop policy if exists "blocked_read"      on public.blocked_users;
drop policy if exists "blocked_write"     on public.blocked_users;
drop policy if exists "mutes_read"        on public.chat_mutes;
drop policy if exists "mutes_write"       on public.chat_mutes;
drop policy if exists "clears_read"       on public.chat_clears;
drop policy if exists "clears_write"      on public.chat_clears;

-- message_attachments: anyone in the same chat can read; sender can write
create policy "attachments_read" on public.message_attachments for select
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_attachments.message_id
        and (m.sender_id = auth.uid()
             or exists (
               select 1 from public.chats c
               where c.id = m.chat_id
                 and (c.user_a = auth.uid() or c.user_b = auth.uid())
             ))
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

-- saved_messages: owner only
create policy "saved_read"   on public.saved_messages for select using (user_id = auth.uid());
create policy "saved_write"  on public.saved_messages for insert  with check (user_id = auth.uid());
create policy "saved_delete" on public.saved_messages for delete  using (user_id = auth.uid());

-- blocked_users: owner only
create policy "blocked_read"  on public.blocked_users for select using (blocker_id = auth.uid());
create policy "blocked_write" on public.blocked_users for all    using (blocker_id = auth.uid())
                                                          with check (blocker_id = auth.uid());

-- chat_mutes / chat_clears: owner only
create policy "mutes_read"   on public.chat_mutes  for select using (user_id = auth.uid());
create policy "mutes_write"  on public.chat_mutes  for all    using (user_id = auth.uid())
                                                          with check (user_id = auth.uid());
create policy "clears_read"  on public.chat_clears for select using (user_id = auth.uid());
create policy "clears_write" on public.chat_clears for all    using (user_id = auth.uid())
                                                          with check (user_id = auth.uid());

-- 8. Storage bucket -----------------------------------------
-- Attachments bucket. Run via SQL only if your project has the storage extension.
insert into storage.buckets (id, name, public)
  values ('attachments', 'attachments', true)
  on conflict (id) do nothing;

-- Storage policies: allow any authenticated user to upload/read their own folder.
-- (Files are saved under <user_id>/<file> so the policy can match the prefix.)
drop policy if exists "attachments_storage_read"  on storage.objects;
drop policy if exists "attachments_storage_write" on storage.objects;

create policy "attachments_storage_read" on storage.objects for select
  using ( bucket_id = 'attachments' );

create policy "attachments_storage_write" on storage.objects for insert
  with check (
    bucket_id = 'attachments'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 9. block-messaging trigger --------------------------------
-- Drop messages from blocked users (B→A where A blocked B).
-- Implemented as a BEFORE INSERT trigger on messages.
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
  -- Resolve the two participants of the chat
  select user_a, user_b into chat_user_a, chat_user_b
  from public.chats where id = NEW.chat_id;

  if chat_user_a is null then
    return NEW;
  end if;

  -- The recipient is the other user
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
    -- Silently drop the message
    return null;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_block_message_if_blocked on public.messages;
create trigger trg_block_message_if_blocked
  before insert on public.messages
  for each row execute function public.block_message_if_blocked();

-- 10. chats: ensure a user can message themselves ("Saved Messages" chat) ----
-- The RPC get_or_create_chat may not allow user_a == user_b. We patch it
-- to always allow self-chat and return the deterministic chat id.
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
  -- self-chat: deterministic id
  if user_a = user_b then
    select id into found_id from public.chats
      where user_a = user_a and user_b = user_b limit 1;
    if found_id is null then
      insert into public.chats (user_a, user_b)
        values (user_a, user_b)
        returning id into found_id;
    end if;
    return found_id;
  end if;

  -- pair chat: always store with (lo, hi) ordering so the (a,b)/(b,a) lookup works
  if user_a < user_b then
    lo := user_a; hi := user_b;
  else
    lo := user_b; hi := user_a;
  end if;

  select id into found_id from public.chats
    where (user_a = lo and user_b = hi)
       or (user_a = hi and user_b = lo)
    limit 1;

  if found_id is null then
    insert into public.chats (user_a, user_b) values (lo, hi)
      returning id into found_id;
  end if;

  return found_id;
end;
$$;
