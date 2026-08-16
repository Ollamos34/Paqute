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
  return error ? err(error) : ok(data || []);
}

export async function addAttachment({ messageId, kind, url, fileName, mimeType, sizeBytes, meta = {} }) {
  const { data, error } = await supabase
    .from('message_attachments')
    .insert({
      message_id: messageId,
      kind,
      url,
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
  const { error } = await supabase
    .from('messages')
    .update({ deleted_for_everyone: true, content: '', updated_at: new Date().toISOString() })
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
  const { data: pub } = supabase.storage.from('attachments').getPublicUrl(path);
  return ok({ url: pub.publicUrl, path });
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
