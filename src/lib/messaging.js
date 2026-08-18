// Thin wrappers around Supabase for messaging features.
// Each function returns a normalized result { data, error } and never throws.

import { supabase } from '../supabaseClient';

const ok  = (data) => ({ data, error: null });
const err = (error) => ({ data: null, error });

// ----- chats -----

export async function getOrCreateChat(userA, userB) {
  const { data, error } = await supabase.rpc('get_or_create_chat', {
    user_a: userA,
    user_b: userB,
  });
  return error ? err(error) : ok(data);
}

export async function loadMessages(chatId) {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true });
  return error ? err(error) : ok(data || []);
}

export async function sendMessage({ chatId, senderId, content, replyTo = null, clientId = null }) {
  // Optimistic UI: caller renders a temp row with clientId first.
  // The realtime subscription will dedupe by clientId and replace
  // the optimistic row with the real one Postgres echoes.
  const row = {
    chat_id: chatId,
    sender_id: senderId,
    content,
  };
  if (replyTo) row.reply_to = replyTo;
  if (clientId) row.client_id = clientId;

  const { data, error } = await supabase
    .from('messages')
    .insert(row)
    .select()
    .single();

  if (error) return err(error);
  return ok(data);
}

export async function loadAttachments(messageIds) {
  if (!messageIds || messageIds.length === 0) return ok([]);
  const { data, error } = await supabase
    .from('message_attachments')
    .select('*')
    .in('message_id', messageIds);
  if (error) return err(error);
  // Re-sign each row's storage_path so the URL works regardless of
  // whether the bucket is public. Rows without storage_path fall
  // back to whatever's in `url` (legacy rows may still have a
  // working public URL there).
  const rows = data || [];
  const resolved = await Promise.all(rows.map(resolveAttachmentUrl));
  // Drop rows that ended up with no URL at all — they'd render as
  // a broken image. The caller treats these as "no attachment".
  return ok(resolved.filter(r => r && r.url));
}

export async function addAttachment({ messageId, kind, url, fileName, mimeType, sizeBytes, storagePath = null, meta = {} }) {
  const { data, error } = await supabase
    .from('message_attachments')
    .insert({
      message_id: messageId,
      kind,
      url,
      storage_path: storagePath,
      file_name: fileName,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      meta,
    })
    .select()
    .single();
  return error ? err(error) : ok(data);
}

export async function deleteMessageForEveryone(messageId) {
  // `content` is a generated column aliasing `text`, so we clear `text`
  // and flip the flag. Postgres will recompute `content` from `text`.
  const { error } = await supabase
    .from('messages')
    .update({ deleted_for_everyone: true, text: '', updated_at: new Date().toISOString() })
    .eq('id', messageId);
  return error ? err(error) : ok(true);
}

// ----- uploads -----

export async function uploadAttachment(file, userId) {
  const safeName = file.name.replace(/[^\w.\-]+/g, '_');
  const path = `${userId}/${Date.now()}_${safeName}`;
  const { error: upErr } = await supabase.storage
    .from('attachments')
    .upload(path, file, { upsert: false });
  if (upErr) return err(upErr);
  // Issue a transient signed URL so the optimistic UI can render the
  // image immediately after upload. The persisted reference is the
  // storage `path`; on every load we re-sign the path so the URL
  // keeps working even if the bucket is private or its policy changes.
  const { data: signed, error: signErr } = await supabase.storage
    .from('attachments')
    .createSignedUrl(path, 60 * 60); // 1h — long enough for the optimistic render
  const url = signed?.signedUrl || '';
  if (signErr) return err(signErr);
  return ok({ url, path });
}

// Resolve a stored attachment row to a working URL. Prefers a fresh
// signed URL from `storage_path` (works regardless of bucket privacy);
// falls back to the legacy `url` field for rows created before the
// migration. If the storage object itself is missing, returns the
// att with an empty url so the caller can drop it.
export async function resolveAttachmentUrl(att) {
  if (!att) return att;
  if (att.storage_path) {
    const { data, error } = await supabase.storage
      .from('attachments')
      .createSignedUrl(att.storage_path, 60 * 60 * 24 * 7); // 7 days
    if (!error && data?.signedUrl) {
      return { ...att, url: data.signedUrl };
    }
    // Signing failed (object missing, perms changed, etc.). Log so
    // the bug is visible in dev tools and fall through to the
    // legacy url field — if that's also missing, the row is dropped
    // by loadAttachments' filter.
    if (error) console.warn('resolveAttachmentUrl: sign failed', error);
  }
  // No storage_path OR signing failed — use the legacy url field,
  // but only if it looks like it could still work (public URL or a
  // fresh signed URL). Empty-string urls are dropped by the caller.
  return att;
}

export function detectKind(file) {
  const mime = (file.type || '').toLowerCase();
  if (mime.startsWith('image/'))         return 'image';
  if (mime.startsWith('video/'))         return 'video';
  if (mime.startsWith('audio/'))         return 'audio';
  return 'document';
}

// ----- saved messages -----

export async function loadSavedMessages(userId) {
  const { data, error } = await supabase
    .from('saved_messages')
    .select('*')
    .eq('user_id', userId)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false });
  return error ? err(error) : ok(data || []);
}

export async function createSavedMessage({ userId, kind = 'note', text, url, fileName, mimeType, sizeBytes, meta = {}, remindAt = null, pinned = false, sourceChatId = null, sourceMessageId = null }) {
  const row = {
    user_id: userId,
    kind, text, url, file_name: fileName, mime_type: mimeType, size_bytes: sizeBytes,
    meta, remind_at: remindAt, pinned,
    source_chat_id: sourceChatId, source_message_id: sourceMessageId,
  };
  const { data, error } = await supabase
    .from('saved_messages')
    .insert(row)
    .select()
    .single();
  return error ? err(error) : ok(data);
}

export async function deleteSavedMessage(id, userId) {
  const { error } = await supabase
    .from('saved_messages')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  return error ? err(error) : ok(true);
}

export async function togglePinSavedMessage(id, userId, pinned) {
  const { data, error } = await supabase
    .from('saved_messages')
    .update({ pinned: !pinned })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();
  return error ? err(error) : ok(data);
}

export async function markReminded(id, userId) {
  const { error } = await supabase
    .from('saved_messages')
    .update({ reminded: true })
    .eq('id', id)
    .eq('user_id', userId);
  return error ? err(error) : ok(true);
}

// ----- block / mute / clear -----

export async function blockUser(blockerId, blockedId) {
  const { error } = await supabase
    .from('blocked_users')
    .insert({ blocker_id: blockerId, blocked_id: blockedId });
  // 23505 = unique_violation → already blocked, treat as success
  if (error && error.code !== '23505') return err(error);
  return ok(true);
}

export async function unblockUser(blockerId, blockedId) {
  const { error } = await supabase
    .from('blocked_users')
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId);
  return error ? err(error) : ok(true);
}

export async function isBlocked(blockerId, blockedId) {
  const { data, error } = await supabase
    .from('blocked_users')
    .select('blocked_id')
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId)
    .maybeSingle();
  return error ? err(error) : ok(!!data);
}

export async function muteChat(userId, chatId, mutedUntil = null) {
  const { error } = await supabase
    .from('chat_mutes')
    .upsert({ user_id: userId, chat_id: chatId, muted_until: mutedUntil });
  return error ? err(error) : ok(true);
}

export async function clearChat(userId, chatId) {
  const { error } = await supabase
    .from('chat_clears')
    .upsert({ user_id: userId, chat_id: chatId, cleared_at: new Date().toISOString() });
  if (error) return err(error);
  // also wipe local copy so the UI clears immediately
  return ok(true);
}

export async function getClearedAt(userId, chatId) {
  const { data, error } = await supabase
    .from('chat_clears')
    .select('cleared_at')
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .maybeSingle();
  return error ? err(error) : ok(data?.cleared_at || null);
}
