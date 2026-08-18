# Supabase Setup Guide — Paqute Messenger

This guide walks you through the **complete** Supabase configuration required for the messenger to work — auth, database schema, storage buckets, Row Level Security policies, Realtime, email templates, and CORS — with copy-pasteable values wherever possible.

If you only do part of this, the app **will** break: the most common failure mode is "I signed up but I see no chats / can't send messages / images disappear after refresh." Every section below fixes a specific failure mode the project actually has.

---

## 1. Prerequisites

- A Supabase account (free tier is enough for development): <https://supabase.com>
- Node.js 18+ and the project cloned locally
- Two env vars (see `.env.example`):
  ```
  VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
  VITE_SUPABASE_ANON_KEY=eyJ...   (the `anon` / `publishable` key)
  ```

The app reads these via `src/supabaseClient.js`. After editing `.env.local`, restart `npm run dev`.

> ⚠️ **Never** commit `.env.local`. The `anon` key is technically public (it ships in the bundle), but **service-role keys must stay out of the repo**.

---

## 2. Create the project

1. Go to **Supabase Dashboard → New project**.
2. Pick a region close to your users (e.g. `eu-central-1` for EU/UA, `us-east-1` for the Americas).
3. Set a strong **Database password** — you only need it for the SQL Editor, the app itself uses the anon key.
4. Wait for provisioning (~2 minutes).
5. Once ready, copy the **Project URL** and **anon public key** from **Project Settings → API** into `.env.local`.

---

## 3. Authentication

Open **Authentication → Providers** and configure:

### 3.1 Email provider
- ✅ **Enable Email provider** (default ON).
- ✅ **Confirm email** — decide based on your UX goal:
  - **ON (recommended for production):** new users receive a confirmation email. `signUp()` resolves with `data.session = null` and the user must click the link.
  - **OFF (faster dev):** `signUp()` immediately returns a session; `Login.jsx` shows the "check your email" message either way. If you toggle OFF for dev, remember to toggle it back ON before going live.
- **Secure email change:** ON.
- **Double confirm email change:** ON.

### 3.2 URL configuration
Open **Authentication → URL Configuration**:

| Field | Value |
|------|------|
| Site URL | `http://localhost:5173` for dev, your prod URL (e.g. `https://paqute.vercel.app`) for production |
| Additional Redirect URLs | One per line: `http://localhost:5173`, `http://localhost:4173`, your preview URLs |

Without these, password-reset and email-confirm links 404.

### 3.3 Email templates
**Authentication → Email Templates** — the defaults work, but the **confirmation** template must include `{{ .ConfirmationURL }}` (it does by default). If you replace the template, don't remove that token or users can't confirm.

### 3.4 Optional providers (Google, GitHub, etc.)
If you add OAuth providers, update `Login.jsx`'s social-buttons block. Each provider needs:
- The OAuth client ID/secret in **Authentication → Providers → [provider]**
- The provider enabled in the same panel
- The redirect URL added to **URL Configuration → Additional Redirect URLs** (Supabase prints the exact URL to add)

---

## 4. Database — run the migration

All tables, indexes, RLS policies, triggers, RPCs and storage buckets ship in a single SQL file: **`sql/full_migration.sql`**. It is **idempotent** — safe to re-run.

### 4.1 Run it
1. Open **SQL Editor** in the dashboard.
2. Click **New query**.
3. Paste the entire contents of `sql/full_migration.sql` (or open it from the file tree, `Ctrl/Cmd+A`, copy).
4. Click **Run** (or `Ctrl/Cmd+Enter`).
5. You should see `Success. No rows returned` for every batch. **No errors**.

### 4.2 What it creates

| Object | Purpose |
|------|---------|
| `public.profiles` | Username + avatar for each user; auto-created on signup via `handle_new_user` trigger |
| `public.chats` | Pair conversations (one row per pair of users) |
| `public.messages` | Message body (`text` column, also aliased as `content`), sender, reply target, soft-delete flag, `client_id` for dedup |
| `public.message_attachments` | Files/images sent in chat; `storage_path` lets the client re-sign URLs regardless of bucket privacy |
| `public.saved_messages` | User's "Saved Messages" notebook (notes/links/reminders) |
| `public.blocked_users` | Per-user block list — a trigger prevents blocked users from sending into your chats |
| `public.chat_mutes` | Mute state per (user, chat) |
| `public.chat_clears` | "Clear history" marker per (user, chat) — UI hides messages older than `cleared_at` |
| `public.get_or_create_chat(uid_a, uid_b)` | RPC used by the client to find or create the chat row for a pair |
| Trigger `trg_handle_new_user` | On `auth.users` insert → automatically inserts a `profiles` row |
| Trigger `trg_block_message_if_blocked` | On `messages` insert → silently drops the message if sender is blocked by the recipient |
| `storage.buckets: avatars` (public) | Profile pictures |
| `storage.buckets: attachments` (public) | Message attachments — see §6 for why this bucket must be public |

### 4.3 Verify

After running the migration, sanity-check in **Table Editor**:

- `profiles`, `chats`, `messages`, `message_attachments`, `saved_messages`, `blocked_users`, `chat_mutes`, `chat_clears` all exist.
- Open `public.profiles` → **Policies** tab → you should see `profiles_read`, `profiles_update`, `profiles_insert` listed.
- **Database → Functions** → `get_or_create_chat` and `handle_new_user` are listed.

### 4.4 Username format (gotcha)
`profiles.username` is constrained to `^[A-Za-z0-9_]{3,32}$`. The `handle_new_user` trigger derives a username from the email local-part and uniquifies it with a numeric suffix (`alex1`, `alex2`...). If you need to override the default, update the row after signup:

```sql
update public.profiles set username = 'your_handle' where id = auth.uid();
```

---

## 5. Row Level Security (RLS)

The migration enables RLS on every table and creates the policies. **If you ever drop a policy manually, you must re-run the migration** — the policies are what make users only see their own chats.

Quick health-check queries (run in SQL Editor):

```sql
-- Every table under public should be 'ENABLED'
select schemaname, tablename, rowsecurity
from pg_tables where schemaname = 'public'
order by tablename;
```

If `rowsecurity = false` for any of the seven tables, run the migration again.

---

## 6. Storage buckets

The migration creates two buckets:

### 6.1 `avatars` (public)
- Stores user profile pictures under path `<userId>/<filename>`.
- Upload policy: `auth.role() = 'authenticated'` and the first path segment must equal `auth.uid()`. Users can only write into their own folder.
- Read policy: public (anyone with the URL can view).

### 6.2 `attachments` (public — **intentionally**)
This bucket is **public** by design. Here's why:

- The messenger uses `supabase.storage.from('attachments').getPublicUrl(path)`. That call returns a static URL of the form `…/storage/v1/object/public/attachments/<path>`.
- If you mark the bucket private in the dashboard, `getPublicUrl` **does not throw** — it just returns a URL that 403s when opened. Attachments appear in the chat, then disappear on refresh.
- The RLS-style access control is delegated to the **`message_attachments`** table: a user can only `select` attachments whose parent message lives in one of their chats, and only `insert` an attachment whose message has `sender_id = auth.uid()`. So the **files** are public-but-orphaned — without a chat membership you can't discover the URL.
- If you need stricter privacy later, refactor `lib/messaging.js → resolveAttachmentUrl` to call `createSignedUrl(path, 3600)` instead of `getPublicUrl(path)`, and add an `attachments_storage_signed_read` policy on `storage.objects` keyed off `auth.uid()` and the chat lookup.

### 6.3 Verify buckets
**Storage → attachments → Policies** should list:
- `attachments_storage_read` (`select`, public)
- `attachments_storage_write` (`insert`, authenticated, first path segment = user id)

**Storage → avatars → Policies** should list:
- `avatars_read`, `avatars_write`, `avatars_update`

If any are missing, re-run `sql/full_migration.sql`.

### 6.4 File size limit
The client caps uploads at 25 MB (`errorFileSize` in `i18n.js`). The matching server-side limit is set in **Storage → Settings → File size limit**. Make them consistent — the smaller of the two wins.

---

## 7. Realtime

The app uses Supabase Realtime Channels for live messages and presence. **Realtime publication is OFF by default for new tables** — you must turn it on, otherwise messages only show up after a refresh.

### 7.1 Enable for `messages`
1. **Database → Replication** (or the older **Database → Publications** UI).
2. Open the `supabase_realtime` publication.
3. Make sure `public.messages` is listed under "Tables in Publication".
4. If not, run in SQL Editor:

```sql
alter publication supabase_realtime add table public.messages;
```

### 7.2 Enable for `message_attachments` (optional but recommended)
```sql
alter publication supabase_realtime add table public.message_attachments;
```

The client's `App.jsx` already wires up channels for both tables — without these `alter publication` calls the subscriptions fire no events.

### 7.3 Presence (online status)
Online status is tracked via Realtime presence channels (no DB rows). Just make sure **Realtime** is enabled at the project level — it is by default. If you disabled it, re-enable in **Project Settings → API → Realtime**.

---

## 8. Email delivery (production)

By default, Supabase sends auth emails from `noreply@app.supabase.io` — they go to spam in production.

Recommended for production:
1. **Project Settings → Auth → SMTP** → **Enable Custom SMTP**.
2. Plug in Resend / SendGrid / Postmark / AWS SES.
3. Set the `from` address to a domain you control, e.g. `auth@yourdomain.com`.
4. Add the matching SPF/DKIM records that your SMTP provider gives you.

Without custom SMTP, signup confirmation will appear to "work" but never arrive for some users.

---

## 9. CORS / Network restrictions

If you're behind a corporate VPN or a hardened browser setup, allowlist:
- `https://<your-project-ref>.supabase.co`
- `https://<your-project-ref>.supabase.storage.app` (if you ever switch to private buckets with signed URLs)

Supabase's hosted project allows all origins by default — only tighten this in **Project Settings → API → Allowed CORS origins** if you have a specific need.

---

## 10. End-to-end smoke test

After completing the steps above, this exact sequence must pass:

1. `npm install && npm run dev`
2. Open `http://localhost:5173` → the new login page renders.
3. **Sign up** with a real email you can read. (If `Confirm email` is OFF, you're auto-signed-in.)
4. If `Confirm email` is ON: open the email, click the confirmation link, return to the app — it should drop you into the empty chat list.
5. Open a second browser profile / incognito window and sign up a second account.
6. In window A: search for window B's user, start a chat, send a message "hello".
7. In window B: the message must appear **without a refresh**.
8. Window B replies "hi". Window A sees it live.
9. Attach an image in window A. Window B should see it inline and be able to open it.
10. Window A logs out → window B's avatar shows the offline indicator.

If any step fails, jump to **§12 Troubleshooting**.

---

## 11. Operational notes

- **Backup**: Supabase auto-backs-up the database on the Pro plan. On the free tier, schedule a `pg_dump` from CI (e.g. nightly GitHub Action) using the connection string from **Project Settings → Database**.
- **Migrations from scratch**: `sql/0_base_schema.sql` is a subset kept for reference. **Always use `sql/full_migration.sql`** for fresh setups and for re-applying policy fixes.
- **Schema drift**: if you tweak tables in the dashboard, mirror the changes into `sql/full_migration.sql` immediately — the file is the source of truth and is safe to re-run.

---

## 12. Troubleshooting

### "Sign up succeeds but I land on an empty chat list"
`profiles` row is missing. The `handle_new_user` trigger didn't fire (or its function was overwritten).
```sql
select * from public.profiles where id = '<auth.uid()>';
```
If empty, re-run `sql/full_migration.sql`. The trigger is recreated on every run.

### "I sent an image — it disappeared after I refreshed the page"
The `attachments` bucket is private. Open **Storage → attachments → Settings** → toggle **Public bucket** ON, then re-run the migration (it flips the flag back if you ever flip it again).

### "Messages don't arrive in real time"
- Did you run `alter publication supabase_realtime add table public.messages;`? See §7.
- Check the browser console for `[realtime] subscription error`. If you see `403`, your `VITE_SUPABASE_ANON_KEY` is wrong; `401` means the project is paused.
- **Project paused**: free-tier projects pause after 7 days of no activity. Unpause from the dashboard.

### "Sign up returns `Database error saving new user`"
The `handle_new_user` trigger raised. Most common cause: someone added another trigger to `auth.users` with `security definer` that does something destructive. Open **Database → Roles → supabase_auth** and confirm no other triggers exist on `auth.users` besides `trg_handle_new_user`.

### "I can't send a message — `new row violates row-level security policy for table 'messages'`"
The `messages_write` policy checks both `sender_id = auth.uid()` and that the chat belongs to you. Make sure:
- You opened the chat via the `get_or_create_chat` RPC, not by inserting into `chats` directly. The RPC normalizes ordering; raw inserts can put you on the wrong side.
- The chat row exists: `select * from public.chats where id = '<chat-uuid>';` — both `user_a` and `user_b` should include your `auth.uid()`.

### "I blocked someone but they can still send to me"
The `block_message_if_blocked` trigger runs on insert and silently drops the row. Verify the trigger exists:
```sql
select tgname from pg_trigger where tgname = 'trg_block_message_if_blocked';
```
If missing, re-run the migration.

### "Images upload but only show in the sender's window"
The receiver's `resolveAttachmentUrl` couldn't build the URL. Check the browser console — if you see `Failed to load resource: 403`, the bucket is private (§6.2). If you see `404`, the `storage_path` was never set on the `message_attachments` row — see the **Backfill storage_path** block at the bottom of `full_migration.sql`.

### "OAuth provider login returns `redirect_uri_mismatch`"
Add the exact redirect URL the error screen prints to **Authentication → URL Configuration → Additional Redirect URLs**. Whitespace and trailing slashes matter.

### "Realtime WebSocket repeatedly disconnects / `WebSocket disconnected` loop"
Two root causes — both are now baked into the migration (§7 and §12), but if you applied an older version:

1. **Realtime publication missing.** New tables aren't in `supabase_realtime` by default; without them the channel subscribes to nothing and the browser keeps cycling reconnect attempts.
   ```sql
   alter publication supabase_realtime add table public.messages;
   alter publication supabase_realtime add table public.message_attachments;
   ```
2. **Project paused.** Free-tier projects auto-pause after 7 days of no traffic; Realtime refuses every connection while paused. **Dashboard → General → Project status → Restore**.

Also confirm `.env.local`'s `VITE_SUPABASE_ANON_KEY` matches the current **Project Settings → API → `anon` `public`** key — if the key was rotated, restart `npm run dev`.

### "RPC call returns `PGRST202: function ... not found in the schema cache`"
The server can't find the function with the parameter names you passed. The most common cause in this project is `get_or_create_chat` having `p_user_a` / `p_user_b` parameters while the client sends `user_a` / `user_b`. **PostgREST matches RPCs by parameter name, not by position.** Two fixes — pick one:

```sql
-- Option A: rename the SQL parameters to match the client.
create or replace function public.get_or_create_chat(user_a uuid, user_b uuid)
returns uuid language plpgsql security definer as $$
  -- …same body, with user_a/user_b instead of p_user_a/p_user_b…
$$;
```
…**or** update `src/lib/messaging.js` to call `supabase.rpc('get_or_create_chat', { p_user_a, p_user_b })` instead of `{ user_a, user_b }`. The migration as of the current revision ships with `user_a` / `user_b` — keep them aligned.

---

## 13. Quick-reference SQL cheatsheet

```sql
-- Confirm email OFF (dev only):
update auth.users set email_confirmed_at = now() where id = '...';
-- ↑ only useful if you have a user_id and skipped confirmation

-- Force-create a profile for an existing user:
insert into public.profiles (id, username)
values ('<auth-uid>', 'manual_handle')
on conflict (id) do nothing;

-- Inspect a chat's RLS evaluation as a specific user:
set local role authenticated;
select * from public.chats where id = '<chat-uuid>';

-- Reset all RLS policies on a table (nuclear option):
alter table public.<table> disable row level security;
-- then re-run the migration to recreate them.
```

---

That's it. With these steps the messenger — login, chat, realtime, attachments, blocks, mutes, saved messages — should all work end-to-end.
