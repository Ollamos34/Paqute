import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Send, Paperclip, Search, MoreVertical, Moon, Sun, Menu, X, Star, Settings, LogOut, Check, Bookmark, Reply, AlertTriangle, FileText, Image as ImageIcon, Video, Music, Download, ZoomIn, X as XIcon } from 'lucide-react';
import { getTranslation } from './i18n';
import SettingsWindow from './components/SettingsWindow';
import ChatMenu from './components/ChatMenu';
import SavedMessages from './components/SavedMessages';
import MessageActions from './components/MessageActions';
import { supabase } from './supabaseClient';
import {
  getOrCreateChat, loadMessages, sendMessage as sendMessageDb,
  loadAttachments, uploadAttachment, detectKind,
  resolveAttachmentUrl,
  blockUser, unblockUser, muteChat, clearChat, deleteMessageForEveryone,
} from './lib/messaging';
import Login from './Login';
import ProfileModal from './ProfileModal';
import './App.css';

// Special "profile id" used for the Saved Messages self-chat.
// We render it in the sidebar like a regular contact, but with a
// bookmark icon and a self-avatar.
const SAVED_MESSAGES_ID = '__saved__';

function App() {
  // --- Auth ---
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // --- Data from Supabase ---
  const [contacts, setContacts] = useState([]); // other users, shaped like old MOCK_CONTACTS
  const [onlineIds, setOnlineIds] = useState([]); // presence
  const [myProfile, setMyProfile] = useState(null); // my own profile row
  const [showProfile, setShowProfile] = useState(false);

  // --- Chat state ---
  const [activeChat, setActiveChat] = useState(null); // profile id of the person we're talking to (or SAVED_MESSAGES_ID)
  const [chatIdMap, setChatIdMap] = useState({}); // profileId -> chats.id
  const [messages, setMessages] = useState({}); // profileId -> array of messages
  const [attachments, setAttachments] = useState({}); // messageId -> [attachments]
  const [blockedIds, setBlockedIds] = useState([]); // profile ids blocked by me
  const [hiddenIds, setHiddenIds] = useState([]); // profile ids of chats I deleted
  const [mutedChats, setMutedChats] = useState([]); // chatIds I have muted
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [previewAtt, setPreviewAtt] = useState(null); // attachment shown in lightbox
  const [toast, setToast] = useState(null); // { kind:'info'|'error', text }
  const messageChannelRef = useRef(null);
  const fileInputRef = useRef(null);
  const savedItemsRef = useRef(null); // imperative ref for SavedMessages panel
  // Set of message_ids known to belong to the currently-open chat.
  // Used by the message_attachments realtime handler to drop events
  // for attachments of messages in OTHER chats (realtime can't filter
  // attachments by chat_id because that join isn't supported).
  const chatMessageIdsRef = useRef(new Set());
  // Attachments that arrived via realtime BEFORE their message row
  // did. Realtime has no global ordering across tables, so we hold
  // these and flush them when the messages handler sees the id.
  // Keyed by message_id (the foreign key on the attachment row).
  const pendingAttsRef = useRef(new Map());

  const [inputValue, setInputValue] = useState('');
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('appSettings');
      if (saved) return JSON.parse(saved).mode || 'dark';
    } catch {}
    return 'dark';
  });
  const [language, setLanguage] = useState(() => {
    try { return localStorage.getItem('language') || 'en'; } catch { return 'en'; }
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('favorites') || '[]'); } catch { return []; }
  });
  const [showFavorites, setShowFavorites] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showSettingsWindow, setShowSettingsWindow] = useState(false);
  const [appSettings, setAppSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('appSettings');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      mode: 'dark',
      chatTheme: 'blue',
      font: 'inter',
      fontFamily: 'Inter, sans-serif',
      wallpaper: 'none',
      wallpaperUrl: null,
      wallpaperSize: 'cover',
      customColors: {
        primary: '#2563EB',
        secondary: '#3B82F6',
      }
    };
  });
  const messagesEndRef = useRef(null);
  const headerMenuRef = useRef(null);
  const messageActionRefs = useRef({});

  const t = (key) => getTranslation(language, key);

  const LANGUAGES = [
    { id: 'en', label: 'English', short: 'EN' },
    { id: 'uk', label: 'Українська', short: 'UK' },
    { id: 'ru', label: 'Русский', short: 'RU' },
  ];

  const getLocale = (lang) =>
    lang === 'ru' ? 'ru-RU' : lang === 'uk' ? 'uk-UA' : 'en-US';

  const formatTs = (iso, lang) => {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString(getLocale(lang), { hour: '2-digit', minute: '2-digit' });
  };

  const activeContact = activeChat === SAVED_MESSAGES_ID
    ? { id: SAVED_MESSAGES_ID, name: t('savedMessages'), avatar: null, isSaved: true, online: false }
    : contacts.find(c => c.id === activeChat);
  const currentMessages = messages[activeChat] || [];
  const isSavedChat = activeChat === SAVED_MESSAGES_ID;

  const filteredChats = (() => {
    const list = contacts.filter(chat => {
      if (hiddenIds.includes(chat.id)) return false;
      const matchesSearch = searchQuery === '' ||
        chat.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (chat.lastMessage || '').toLowerCase().includes(searchQuery.toLowerCase());

      if (showFavorites) {
        return matchesSearch && favorites.includes(chat.id);
      }
      return matchesSearch;
    });
    // "Saved Messages" lives at the very top of All Chats, hidden in Favorites only
    if (!showFavorites) {
      return [
        { id: SAVED_MESSAGES_ID, name: t('savedMessages'), avatar: null, isSaved: true, lastMessage: '', timestamp: '', unread: 0, online: false },
        ...list,
      ];
    }
    return list;
  })();

  // ============================================
  // AUTH: track session
  // ============================================
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      // clear user-scoped data when signing out so next user on same browser doesn't see it
      if (!session) {
        setContacts([]);
        setOnlineIds([]);
        setMessages({});
        setChatIdMap({});
        setActiveChat(null);
        if (messageChannelRef.current) {
          supabase.removeChannel(messageChannelRef.current);
          messageChannelRef.current = null;
        }
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // ============================================
  // CONTACTS: load every other profile
  // ============================================
  const loadContacts = useCallback(() => {
    if (!session) return Promise.resolve();
    return supabase
      .from('profiles')
      .select('*')
      .neq('id', session.user.id)
      .then(({ data, error }) => {
        if (error) { console.error(error); return; }
        const shaped = (data || []).map(p => ({
          id: p.id,
          name: p.username,
          avatar: p.avatar_url || null,
          lastMessage: '',
          timestamp: '',
          unread: 0,
          online: false,
        }));
        setContacts(shaped);
      });
  }, [session]);

  useEffect(() => {
    if (!session) return;

    let cancelled = false;
    loadContacts().then(() => {
      if (cancelled) return;
      // Don't auto-pick a chat — let the user choose. If the user
      // already had an active chat from this session, keep it.
      setActiveChat(prev => prev || null);
    });

    return () => { cancelled = true; };
  }, [session, loadContacts]);

  // ============================================
  // MY PROFILE: load own row (for the ProfileModal and sidebar avatar)
  // ============================================
  useEffect(() => {
    if (!session) { setMyProfile(null); return; }
    let cancelled = false;
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { console.error(error); return; }
        setMyProfile(data);
      });
    return () => { cancelled = true; };
  }, [session]);

  // ============================================
  // PRESENCE: who's online right now
  // ============================================
  useEffect(() => {
    if (!session) return;

    const presenceChannel = supabase.channel('online-users', {
      config: { presence: { key: session.user.id } },
    });

    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        setOnlineIds(Object.keys(state));
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({ online_at: new Date().toISOString() });
        }
      });

    return () => { supabase.removeChannel(presenceChannel); };
  }, [session]);

  useEffect(() => {
    setContacts(prev => prev.map(c => ({ ...c, online: onlineIds.includes(c.id) })));
  }, [onlineIds]);

  // ============================================
  // ACTIVE CHAT: get/create chat row + load history + subscribe realtime
  // ============================================
  useEffect(() => {
    if (!session || !activeChat) return;

    let cancelled = false;
    let localChannel = null;

    async function setupChat() {
      // 1. get or create the chat row. self-chat when activeChat === session.user.id
      const otherId = isSavedChat ? session.user.id : activeChat;
      const { data: chatId, error } = await getOrCreateChat(session.user.id, otherId);
      if (error) {
        console.error('get_or_create_chat failed:', error);
        showToast(t('errorChatInit'), 'error');
        return;
      }
      if (cancelled) return;

      setChatIdMap(prev => ({ ...prev, [activeChat]: chatId }));

      // 2. load history + attachments in parallel
      const { data: history, error: histErr } = await loadMessages(chatId);
      if (histErr) console.error('loadMessages failed:', histErr);
      if (cancelled) return;

      const clearedAt = await fetchClearedAtRef.current(chatId);

      const shaped = (history || [])
        .filter(m => !clearedAt || new Date(m.created_at) > new Date(clearedAt))
        .map(m => ({
          id: m.id,
          clientId: m.client_id || null,
          text: m.deleted_for_everyone ? '' : (m.content || ''),
          deleted: !!m.deleted_for_everyone,
          replyTo: m.reply_to || null,
          sender: m.sender_id === session.user.id ? 'me' : 'them',
          createdAt: m.created_at,
          timestamp: formatTs(m.created_at, language),
        }));
      // If a history row carries a client_id we already have an
      // optimistic row for, prefer the history row (it has the
      // canonical id/timestamp) and drop the optimistic duplicate.
      // Seed chatMessageIdsRef with history ids so the attachments
      // realtime handler accepts rows belonging to this chat.
      chatMessageIdsRef.current = new Set(shaped.map(s => s.id));
      // Drop any orphan attachments buffered for the previous chat.
      pendingAttsRef.current = new Map();
      setMessages(prev => {
        const optimistic = (prev[activeChat] || []).filter(
          m => m.pending && m.clientId && !shaped.some(s => s.clientId === m.clientId)
        );
        return { ...prev, [activeChat]: [...shaped, ...optimistic] };
      });

      // load attachments for the visible messages
      const ids = shaped.map(s => s.id);
      const { data: atts } = await loadAttachments(ids);
      if (!cancelled && atts) {
        const grouped = {};
        for (const a of atts) {
          (grouped[a.message_id] ||= []).push(a);
        }
        setAttachments(prev => ({ ...prev, ...grouped }));
      }

      // Race-fix: the send flow writes the `messages` row and the
      // `message_attachments` rows in two separate awaits. If the user
      // refreshes in that small gap, history load returns the message
      // but the attachment row is missing, so the image appears gone
      // until the next refresh. Detect that case (any message with
      // no attachments loaded) and re-query once after a short delay.
      // The previous version only retried for textless messages, so a
      // message that had BOTH text and an attachment could land in
      // this gap and stay "empty" until the next refresh.
      const needsRetry = ids.some(id => {
        const msg = shaped.find(s => s.id === id);
        const hasAtt = atts && atts.some(a => a.message_id === id);
        return msg && !hasAtt;
      });
      if (!cancelled && needsRetry) {
        setTimeout(async () => {
          if (cancelled) return;
          const { data: retryAtts } = await loadAttachments(ids);
          if (cancelled || !retryAtts) return;
          const grouped = {};
          for (const a of retryAtts) {
            (grouped[a.message_id] ||= []).push(a);
          }
          setAttachments(prev => {
            // Only fill in slots that are still empty so we don't
            // clobber attachment rows the realtime channel may have
            // added in the meantime.
            const next = { ...prev };
            for (const [mid, list] of Object.entries(grouped)) {
              if (!next[mid] || next[mid].length === 0) next[mid] = list;
            }
            return next;
          });
        }, 1500);
      }

      // 3. subscribe to new messages in this chat
      if (messageChannelRef.current) {
        supabase.removeChannel(messageChannelRef.current);
        messageChannelRef.current = null;
      }
      const channel = supabase
        .channel(`chat-${chatId}`)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
          (payload) => {
            const m = payload.new;
            const shapedMsg = {
              id: m.id,
              clientId: m.client_id || null,
              text: m.deleted_for_everyone ? '' : (m.content || ''),
              deleted: !!m.deleted_for_everyone,
              replyTo: m.reply_to || null,
              sender: m.sender_id === session.user.id ? 'me' : 'them',
              createdAt: m.created_at,
              timestamp: formatTs(m.created_at, language),
            };
            // Track this message_id so the message_attachments realtime
            // handler can recognize attachments belonging to this chat.
            // Realtime filter can't join across tables, so we cache
            // known ids client-side and filter there.
            chatMessageIdsRef.current.add(m.id);
            // The message_attachments realtime handler may have
            // dropped attachments for this message_id (arrived BEFORE
            // the messages row did). Flush any pending ones now.
            const pending = pendingAttsRef.current.get(m.id);
            if (pending && pending.length) {
              pendingAttsRef.current.delete(m.id);
              setAttachments(prev => {
                const cur = prev[m.id] || [];
                const merged = [...cur];
                for (const att of pending) {
                  if (!merged.some(x => x.id === att.id)) merged.push(att);
                }
                return { ...prev, [m.id]: merged };
              });
            }
            // Decide which path to take INSIDE the setMessages updater
            // so the lookup runs against the latest queued state, not a
            // stale closure copy. The closure `messages` is captured at
            // effect-setup time and doesn't refresh between sends, so
            // reading it here would miss the optimistic row and append
            // the realtime echo as a duplicate.
            let mergedOwn = false;
            setMessages(prev => {
              const cur = prev[activeChat] || [];
              const ownIdx = shapedMsg.clientId
                ? cur.findIndex(x => x.clientId === shapedMsg.clientId && x.pending)
                : -1;
              if (ownIdx !== -1) {
                mergedOwn = true;
                const next = cur.slice();
                next[ownIdx] = {
                  ...next[ownIdx],
                  ...shapedMsg,
                  pending: false,
                  failed: false,
                };
                return { ...prev, [activeChat]: next };
              }
              if (cur.some(x => x.id === shapedMsg.id)) {
                return prev;
              }
              return { ...prev, [activeChat]: [...cur, shapedMsg] };
            });
            if (mergedOwn) {
              // Remap temp attachments keyed by clientId over to the
              // canonical real id so the message keeps showing its
              // attachments after the id swap.
              setAttachments(prevAtts => {
                const tmp = prevAtts[shapedMsg.clientId];
                if (!tmp) return prevAtts;
                const nextAtts = { ...prevAtts };
                delete nextAtts[shapedMsg.clientId];
                nextAtts[shapedMsg.id] = tmp;
                return nextAtts;
              });
            }
            // Fetch attachments for newly-arrived messages. Realtime
            // also subscribes to message_attachments INSERTs (below),
            // so this fallback is only needed if the attachment row
            // arrives before the messages subscription is wired.
            (async () => {
              if (mergedOwn) return;
              const { data: newAtts } = await loadAttachments([shapedMsg.id]);
              if (!cancelled && newAtts && newAtts.length) {
                setAttachments(prev => {
                  // Don't overwrite temp atts the sender's optimistic
                  // path put in place after the realtime echo merged.
                  if (prev[shapedMsg.id] && prev[shapedMsg.id].length) return prev;
                  return { ...prev, [shapedMsg.id]: newAtts };
                });
              }
            })();
            if (!isSavedChat) {
              setContacts(prev => prev.map(c =>
                c.id === activeChat
                  ? { ...c, lastMessage: shapedMsg.text || t('attachment'), timestamp: shapedMsg.timestamp }
                  : c
              ));
            }
          }
        )
        .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
          (payload) => {
            const m = payload.new;
            setMessages(prev => {
              const list = prev[activeChat] || [];
              return {
                ...prev,
                [activeChat]: list.map(x => x.id === m.id
                  ? { ...x, text: m.deleted_for_everyone ? '' : (m.content || ''), deleted: !!m.deleted_for_everyone }
                  : x
                ),
              };
            });
          }
        )
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'message_attachments' },
          (payload) => {
            // Supabase realtime can't filter attachments by chat_id
            // directly (no join across tables). Drop events for
            // attachments that don't belong to a message in this chat.
            const att = payload.new;
            // If we don't know about this message yet (the messages
            // realtime event hasn't fired), buffer the attachment so
            // the messages handler can flush it once the id arrives.
            if (!chatMessageIdsRef.current.has(att.message_id)) {
              const queue = pendingAttsRef.current.get(att.message_id) || [];
              queue.push(att);
              pendingAttsRef.current.set(att.message_id, queue);
              return;
            }
            // The payload's `url` column is whatever the sender's
            // send flow wrote into the row. Re-sign against
            // `storage_path` so the attachment keeps rendering past
            // whatever window the original URL was valid for.
            (async () => {
              const fresh = await resolveAttachmentUrl(att);
              if (cancelled) return;
              setAttachments(prev => {
                const cur = prev[fresh.message_id] || [];
                if (cur.some(x => x.id === fresh.id)) return prev;
                return { ...prev, [fresh.message_id]: [...cur, fresh] };
              });
            })();
          }
        )
        .subscribe();
      if (cancelled) {
        supabase.removeChannel(channel);
        return;
      }
      localChannel = channel;
      messageChannelRef.current = channel;
    }

    setupChat();

    return () => {
      cancelled = true;
      if (localChannel) {
        supabase.removeChannel(localChannel);
        if (messageChannelRef.current === localChannel) {
          messageChannelRef.current = null;
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, activeChat, isSavedChat, language]);

  // ============================================
  // Existing effects (theme, prefs, scroll)
  // ============================================
  useEffect(() => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    });
  }, [currentMessages]);

  useEffect(() => {
    document.body.className = theme === 'light' ? 'light-theme' : '';
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('language', language);
    document.documentElement.lang = language;
  }, [language]);
  useEffect(() => {
    localStorage.setItem('favorites', JSON.stringify(favorites));
  }, [favorites]);
  useEffect(() => {
    localStorage.setItem('appSettings', JSON.stringify(appSettings));
    document.documentElement.style.setProperty('--color-primary', appSettings.customColors.primary);
    document.documentElement.style.setProperty('--color-secondary', appSettings.customColors.secondary);
    document.body.style.fontFamily = appSettings.fontFamily;
    // keep `theme` in sync with `appSettings.mode` so toggles via SettingsWindow flip body class too
    if (theme !== appSettings.mode) setTheme(appSettings.mode);
  }, [appSettings]);

  // close header menu on outside click
  useEffect(() => {
    if (!showHeaderMenu) return;
    const onDown = (e) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target)) {
        setShowHeaderMenu(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showHeaderMenu]);

  // re-format message timestamps when language changes
  useEffect(() => {
    setMessages(prev => {
      const out = {};
      for (const [k, list] of Object.entries(prev)) {
        out[k] = list.map(m => ({
          ...m,
          timestamp: m.createdAt ? formatTs(m.createdAt, language) : m.timestamp,
        }));
      }
      return out;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // ============================================
  // SEND MESSAGE — optimistic insert + real DB write
  // ============================================
  const showToast = (text, kind = 'info') => {
    setToast({ text, kind });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchClearedAt = useCallback(async (chatId) => {
    if (!session || !chatId) return null;
    const { data } = await supabase
      .from('chat_clears')
      .select('cleared_at')
      .eq('user_id', session.user.id)
      .eq('chat_id', chatId)
      .maybeSingle();
    return data?.cleared_at || null;
  }, [session]);

  // keep a ref so the active-chat effect always reads the latest fn
  const fetchClearedAtRef = useRef(fetchClearedAt);
  useEffect(() => { fetchClearedAtRef.current = fetchClearedAt; }, [fetchClearedAt]);

const sendOne = useCallback(async (text, opts = {}) => {
    if (!session) return;
    let chatId = chatIdMap[activeChat];
    if (!chatId && activeChat) {
      const otherId = isSavedChat ? session.user.id : activeChat;
      const { data, error } = await getOrCreateChat(session.user.id, otherId);
      if (error || !data) {
        showToast(t('errorSend'), 'error');
        return null;
      }
      chatId = data;
      setChatIdMap(prev => ({ ...prev, [activeChat]: chatId }));
    }
    if (!chatId) return null;

    const clientId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const optimistic = {
      id: clientId,
      clientId,
      pending: true,
      failed: false,
      text: text || '',
      deleted: false,
      replyTo: replyTo?.id || null,
      replyToText: replyTo?.text || null,
      sender: 'me',
      createdAt: new Date().toISOString(),
      timestamp: formatTs(new Date().toISOString(), language),
      attachments: opts.attachments || [],
    };
    setMessages(prev => ({
      ...prev,
      [activeChat]: [...(prev[activeChat] || []), optimistic],
    }));
    // Surface attachments on the optimistic row immediately (keyed by
    // clientId) so a freshly selected image renders without waiting
    // for the realtime echo to swap ids. We persist `storage_path`
    // (not the transient signed url) on the row so we can re-sign on
    // every load.
    if (opts.attachments && opts.attachments.length) {
      const tempAtts = opts.attachments.map((a, i) => ({
        id: `tmp-${clientId}-${i}`,
        message_id: clientId,
        kind: a.kind,
        url: a.url,
        storage_path: a.storagePath || null,
        file_name: a.fileName,
        mime_type: a.mimeType,
        size_bytes: a.sizeBytes,
        meta: {},
        created_at: new Date().toISOString(),
        _tmp: true,
      }));
      setAttachments(prev => ({ ...prev, [clientId]: tempAtts }));
    }
    // NOTE: do NOT clear replyTo here — if the DB insert fails, the
    // user should still see what they were replying to and be able to
    // retry without losing context. Clear it on success below.

    const { data: real, error } = await sendMessageDb({
      chatId,
      senderId: session.user.id,
      content: text,
      replyTo: replyTo?.id || null,
      clientId,
    });

    if (error) {
      console.error('sendMessage failed:', error);
      setMessages(prev => ({
        ...prev,
        [activeChat]: (prev[activeChat] || []).map(m =>
          m.id === clientId ? { ...m, failed: true, pending: false } : m
        ),
      }));
      showToast(t('errorSend'), 'error');
      // Keep replyTo intact so user can retry.
      return null;
    }

    // Clear reply context now that the message landed.
    setReplyTo(null);

    // Remap temp attachments (keyed by clientId) onto the canonical
    // real.id FIRST, so the message keeps showing its image/file during
    // the brief window before the DB insert of attachment rows completes.
    setAttachments(prevAtts => {
      const tmp = prevAtts[clientId];
      if (!tmp) return prevAtts;
      const nextAtts = { ...prevAtts };
      delete nextAtts[clientId];
      nextAtts[real.id] = tmp;
      return nextAtts;
    });

    // swap optimistic row for the real one (keep any pending attachments)
    setMessages(prev => ({
      ...prev,
      [activeChat]: (prev[activeChat] || []).map(m =>
        m.id === clientId
          ? { ...m, id: real.id, pending: false, createdAt: real.created_at, timestamp: formatTs(real.created_at, language) }
          : m
      ),
    }));

    // link attachments
    if (opts.attachments && opts.attachments.length) {
      const insertedAtts = [];
      for (const att of opts.attachments) {
        // Don't persist the short-lived signed URL in the DB — only
        // the storage_path. The DB `url` field is legacy; new rows
        // store empty so a later refresh can't resurrect an expired
        // 1h signed URL. Every load re-signs via resolveAttachmentUrl.
        const { data: newAtt, error: attErr } = await supabase
          .from('message_attachments')
          .insert({
            message_id: real.id,
            kind: att.kind,
            url: '',
            storage_path: att.storagePath || null,
            file_name: att.fileName,
            mime_type: att.mimeType,
            size_bytes: att.sizeBytes,
          })
          .select().single();
        if (!attErr && newAtt) {
          // Re-sign immediately so the inserted row has a working URL.
          // Without this the row has `url: ''` and renders as a broken
          // image until something else triggers resolveAttachmentUrl.
          const signed = await resolveAttachmentUrl(newAtt);
          insertedAtts.push(signed);
        } else if (attErr) {
          console.error('attachment insert failed:', attErr, 'kind was:', att.kind);
        }
      }
      // Replace temp attachments with the canonical DB rows so the
      // message shows real attachment ids with fresh signed URLs.
      if (insertedAtts.length) {
        setAttachments(prev => ({ ...prev, [real.id]: insertedAtts }));
      } else {
        console.warn('attachment insert failed; temp atts preserved');
        showToast(t('errorUpload'), 'error');
      }
    }

    if (!isSavedChat) {
      setContacts(prev => prev.map(c =>
        c.id === activeChat
          ? { ...c, lastMessage: text || t('attachment'), timestamp: formatTs(new Date().toISOString(), language) }
          : c
      ));
    }
    return real;
  }, [activeChat, chatIdMap, isSavedChat, language, replyTo, session, t]);

  const handleSendMessage = async () => {
    if (sending) return; // guard against double-send on rapid Enter
    if (!inputValue.trim() || !activeChat || !session) return;

    setSending(true);
    const text = inputValue;
    setInputValue('');
    try {
      await sendOne(text);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (e.nativeEvent && e.nativeEvent.isComposing) return; // IME guard for ru/uk
    e.preventDefault();
    handleSendMessage();
  };

  // file attachment
  const handleFilePick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !session) return;
    if (file.size > 25 * 1024 * 1024) {
      showToast(t('errorFileSize'), 'error');
      return;
    }
    const { data: up, error: upErr } = await uploadAttachment(file, session.user.id);
    if (upErr) {
      console.error('upload failed:', upErr);
      showToast(t('errorUpload'), 'error');
      return;
    }
    await sendOne('', {
      attachments: [{
        kind: detectKind(file),
        url: up.url,
        storagePath: up.path,
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      }],
    });
  };
  // ============================================
  // CHAT MENU actions (block / mute / clear / search)
  // ============================================
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const chatMenuRef = useRef(null);

  useEffect(() => {
    if (!chatMenuOpen) return;
    const onDown = (e) => {
      if (chatMenuRef.current && !chatMenuRef.current.contains(e.target)) {
        setChatMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [chatMenuOpen]);

  const isBlocked = activeChat && blockedIds.includes(activeChat);
  const isMuted = chatIdMap[activeChat] && mutedChats.includes(chatIdMap[activeChat]);

  const handleToggleBlock = async () => {
    if (!activeChat || isSavedChat || !session) return;
    if (isBlocked) {
      await unblockUser(session.user.id, activeChat);
      setBlockedIds(prev => prev.filter(id => id !== activeChat));
      showToast(t('unblocked'), 'info');
    } else {
      await blockUser(session.user.id, activeChat);
      setBlockedIds(prev => [...prev, activeChat]);
      showToast(t('blocked'), 'info');
    }
    setChatMenuOpen(false);
  };

  const handleToggleMute = async () => {
    if (!activeChat || isSavedChat || !session) return;
    const chatId = chatIdMap[activeChat];
    if (!chatId) return;
    if (isMuted) {
      await supabase.from('chat_mutes').delete().eq('user_id', session.user.id).eq('chat_id', chatId);
      setMutedChats(prev => prev.filter(id => id !== chatId));
      showToast(t('unmuted'), 'info');
    } else {
      await muteChat(session.user.id, chatId);
      setMutedChats(prev => [...prev, chatId]);
      showToast(t('muted'), 'info');
    }
    setChatMenuOpen(false);
  };

  const handleClearChat = async () => {
    if (!activeChat || isSavedChat || !session) return;
    if (!window.confirm(t('confirmClear'))) return;
    const chatId = chatIdMap[activeChat];
    await clearChat(session.user.id, chatId);
    // Only clear this chat's messages + attachments; don't wipe other chats' attachments.
    setMessages(prev => ({ ...prev, [activeChat]: [] }));
    const msgIds = (messages[activeChat] || []).map(m => m.id);
    if (msgIds.length) {
      setAttachments(prev => {
        const next = { ...prev };
        for (const id of msgIds) delete next[id];
        return next;
      });
    }
    showToast(t('cleared'), 'info');
    setChatMenuOpen(false);
  };

  const handleDeleteChat = async () => {
    if (!activeChat || isSavedChat || !session) return;
    if (!window.confirm(t('confirmDelete'))) return;
    const msgIds = (messages[activeChat] || []).map(m => m.id);
    setMessages(prev => ({ ...prev, [activeChat]: [] }));
    if (msgIds.length) {
      setAttachments(prev => {
        const next = { ...prev };
        for (const id of msgIds) delete next[id];
        return next;
      });
    }
    await supabase.from('hidden_chats').upsert({
      user_id: session.user.id,
      chat_id: activeChat,
    });
    setHiddenIds(prev => [...prev, activeChat]);
    setFavorites(prev => prev.filter(id => id !== activeChat));
    showToast(t('chatDeleted'), 'info');
    setChatMenuOpen(false);
    setActiveChat(null);
  };

  // load my block list once
  useEffect(() => {
    if (!session) return;
    supabase
      .from('blocked_users')
      .select('blocked_id')
      .eq('blocker_id', session.user.id)
      .then(({ data }) => setBlockedIds((data || []).map(r => r.blocked_id)));
  }, [session]);

 // load my hidden (deleted) chats once
  useEffect(() => {
    if (!session) return;
    supabase
      .from('hidden_chats')
      .select('chat_id')
      .eq('user_id', session.user.id)
      .then(({ data }) => setHiddenIds((data || []).map(r => r.chat_id)));
  }, [session]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setAppSettings(prev => ({ ...prev, mode: next }));
  };

  const toggleFavorite = (chatId) => {
    if (!chatId) return;
    setFavorites(prev =>
      prev.includes(chatId) ? prev.filter(id => id !== chatId) : [...prev, chatId]
    );
  };

  const handleSearchToggle = () => {
    setShowSearch(prev => {
      if (prev) setSearchQuery('');
      return !prev;
    });
  };

  const handleOpenSettingsWindow = () => setShowSettingsWindow(true);
  const handleCloseSettingsWindow = () => setShowSettingsWindow(false);
  const handleSettingsChange = (newSettings) => {
    setAppSettings(newSettings);
    setTheme(newSettings.mode);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  // ============================================
  // RENDER
  // ============================================
  if (authLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>{t('loading')}</p>
      </div>
    );
  }

  if (!session) {
    return <Login />;
  }

  return (
    <div className="app">
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <button
            className="profile-chip"
            onClick={() => setShowProfile(true)}
            aria-label={t('profile') || 'Профиль'}
            title={t('profile') || 'Профиль'}
          >
            <Avatar
              src={myProfile?.avatar_url}
              name={myProfile?.username || ''}
              size={30}
              className="profile-chip-avatar"
            />
            <span className="profile-chip-meta">
              <span className="profile-chip-name">{myProfile?.username || t('profile') || 'Профиль'}</span>
              <span className="profile-chip-sub">{t('chats')}</span>
            </span>
          </button>
          <div className="sidebar-brand">
            <div className="sidebar-brand-mark" aria-hidden>φ</div>
            <span className="sidebar-brand-name">Paqute</span>
          </div>
          <div className="header-menu-wrapper" ref={headerMenuRef}>
            <button
              className="icon-btn"
              onClick={() => setShowHeaderMenu(v => !v)}
              aria-label={t('more') || 'Меню'}
              aria-expanded={showHeaderMenu}
              aria-haspopup="menu"
            >
              <MoreVertical size={18} />
            </button>
            {showHeaderMenu && (
              <div className="header-menu" role="menu">
                <button
                  className="header-menu-item"
                  onClick={() => { toggleTheme(); setShowHeaderMenu(false); }}
                  role="menuitem"
                >
                  {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                  <span>{theme === 'dark' ? t('lightTheme') : t('darkTheme')}</span>
                </button>
                <div className="header-menu-divider" />
                <div className="header-menu-section-label">{t('language')}</div>
                {LANGUAGES.map(l => (
                  <button
                    key={l.id}
                    className={`header-menu-item ${language === l.id ? 'active' : ''}`}
                    onClick={() => { setLanguage(l.id); setShowHeaderMenu(false); }}
                    role="menuitemradio"
                    aria-checked={language === l.id}
                  >
                    <span>{l.label}</span>
                    {language === l.id && <Check size={14} />}
                  </button>
                ))}
                <div className="header-menu-divider" />
                <button
                  className="header-menu-item"
                  onClick={() => { handleSearchToggle(); setShowHeaderMenu(false); }}
                  role="menuitem"
                >
                  <Search size={16} />
                  <span>{t('search')}</span>
                </button>
                <button
                  className="header-menu-item"
                  onClick={() => { handleOpenSettingsWindow(); setShowHeaderMenu(false); }}
                  role="menuitem"
                >
                  <Settings size={16} />
                  <span>{t('settings')}</span>
                </button>
                <div className="header-menu-divider" />
                <button
                  className="header-menu-item danger"
                  onClick={() => { handleSignOut(); setShowHeaderMenu(false); }}
                  role="menuitem"
                >
                  <LogOut size={16} />
                  <span>{t('signOut')}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {showSearch && (
          <div className="search-bar">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              className="search-input"
              placeholder={t('search')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery && (
              <button className="icon-btn-small" onClick={() => setSearchQuery('')} aria-label="Clear">
                <X size={16} />
              </button>
            )}
          </div>
        )}

        <div className="chat-tabs">
          <button className={`tab ${!showFavorites ? 'active' : ''}`} onClick={() => setShowFavorites(false)}>
            {t('allChats')}
          </button>
          <button className={`tab ${showFavorites ? 'active' : ''}`} onClick={() => setShowFavorites(true)}>
            <Star size={16} />
            {t('favorites')}
            {favorites.length > 0 && <span className="tab-badge">{favorites.length}</span>}
          </button>
        </div>

        <div className="chat-list">
          {filteredChats.length === 0 ? (
            <div className="empty-state">
              <p>{showFavorites ? t('noFavorites') : (contacts.length === 0 ? t('noOtherUsers') : t('noChats'))}</p>
            </div>
          ) : (
            filteredChats.map(chat => (
              <div
                key={chat.id}
                className={`chat-item ${activeChat === chat.id ? 'active' : ''} ${chat.isSaved ? 'is-saved' : ''}`}
                onClick={() => {
                  setActiveChat(chat.id);
                  if (window.innerWidth < 768) setSidebarOpen(false);
                }}
              >
                <div className="chat-avatar-wrapper">
                  {chat.isSaved ? (
                    <div className="chat-avatar saved-avatar" aria-hidden>
                      <Bookmark size={20} />
                    </div>
                  ) : (
                    <>
                      <Avatar src={chat.avatar} name={chat.name} size={40} className="chat-avatar" />
                      {chat.online && <span className="online-indicator" />}
                    </>
                  )}
                </div>
                <div className="chat-info">
                  <div className="chat-info-top">
                    <h3 className="chat-name">{chat.name}</h3>
                    <span className="chat-time">{chat.timestamp}</span>
                  </div>
                  <div className="chat-info-bottom">
                    <p className="chat-last-message">{chat.lastMessage || (chat.isSaved ? t('savedHint') : '')}</p>
                    {chat.unread > 0 && <span className="unread-badge">{chat.unread}</span>}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="chat-main">
        <header className="chat-header">
          <div className="chat-header-left">
            <button className="icon-btn mobile-only" onClick={() => setSidebarOpen(true)} aria-label={t('openMenu')}>
              <Menu size={20} />
            </button>
            <div className="chat-avatar-wrapper">
              {isSavedChat ? (
                <div className="chat-avatar saved-avatar" aria-hidden>
                  <Bookmark size={20} />
                </div>
              ) : (
                <>
                  <Avatar src={activeContact?.avatar} name={activeContact?.name} size={40} className="chat-avatar" />
                  {activeContact?.online && <span className="online-indicator" />}
                </>
              )}
            </div>
            <div className="chat-header-info">
              <h2 className="chat-header-name">{activeContact?.name || t('selectChat')}</h2>
              <p className="chat-header-status">
                {isSavedChat ? t('savedHint')
                  : activeContact?.online ? t('online')
                  : ''}
              </p>
            </div>
          </div>
          <div className="chat-header-actions">
            <button
              className={`icon-btn ${favorites.includes(activeChat) ? 'active' : ''}`}
              onClick={() => toggleFavorite(activeChat)}
              aria-label={favorites.includes(activeChat) ? t('removeFromFavorites') : t('addToFavorites')}
            >
              <Star size={20} fill={favorites.includes(activeChat) ? 'currentColor' : 'none'} />
            </button>
            {!isSavedChat && (
              <button
                className="icon-btn"
                onClick={() => setChatSearchOpen(v => !v)}
                aria-label={t('searchInChat')}
              >
                <Search size={20} />
              </button>
            )}
            <div className="chat-menu-wrapper" ref={chatMenuRef}>
              <button
                className="icon-btn"
                onClick={() => setChatMenuOpen(v => !v)}
                aria-label={t('more')}
                aria-expanded={chatMenuOpen}
                aria-haspopup="menu"
              >
                <MoreVertical size={20} />
              </button>
              {chatMenuOpen && (
                <ChatMenu
                  isSaved={isSavedChat}
                  isBlocked={isBlocked}
                  isMuted={isMuted}
                  isFavorite={favorites.includes(activeChat)}
                  onToggleBlock={handleToggleBlock}
                  onToggleMute={handleToggleMute}
                  onClear={handleClearChat}
                  onDelete={handleDeleteChat}
                  onToggleFavorite={() => { toggleFavorite(activeChat); setChatMenuOpen(false); }}
                  onClose={() => setChatMenuOpen(false)}
                  t={t}
                />
              )}
            </div>
          </div>
        </header>

        {!activeChat ? (
          <div className="chat-empty">
            <div className="chat-empty-inner">
              <div className="chat-empty-mark" aria-hidden>
                <Send size={28} />
              </div>
              <h2 className="chat-empty-title">{t('selectChat')}</h2>
              <p className="chat-empty-hint">{t('selectChatHint') || 'Select a chat to start messaging'}</p>
            </div>
          </div>
        ) : isSavedChat ? (
          <SavedMessages
            ref={savedItemsRef}
            userId={session.user.id}
            onToast={showToast}
            t={t}
          />
        ) : (
          <>
            <div
              className="messages-container"
              style={{
                background: appSettings.wallpaperUrl ? appSettings.wallpaperUrl : 'var(--color-background)',
                backgroundSize: appSettings.wallpaperSize || 'cover',
              }}
            >
              {chatSearchOpen && (
                <div className="chat-search-bar">
                  <Search size={16} />
                  <input
                    type="text"
                    value={chatSearchQuery}
                    onChange={(e) => setChatSearchQuery(e.target.value)}
                    placeholder={t('searchInChat')}
                    autoFocus
                  />
                  <button className="icon-btn-small" onClick={() => { setChatSearchOpen(false); setChatSearchQuery(''); }}>
                    <X size={14} />
                  </button>
                </div>
              )}
              <div className="messages-list">
                {currentMessages.length === 0 && (
                  <div className="empty-state">{t('noMessages')}</div>
                )}
                {currentMessages
                  .filter(m => !chatSearchQuery || (m.text || '').toLowerCase().includes(chatSearchQuery.toLowerCase()))
                  .map(msg => {
                    // Double-click to reply works for any non-deleted message
                    // (own + received). Deleted messages still can't be replied to.
                    const canReply = !msg.pending && !msg.failed && !msg.deleted;
                    const onTouchStart = canReply ? () => {
                      const t = setTimeout(() => setReplyTo(msg), 500);
                      const clear = () => clearTimeout(t);
                      document.addEventListener('touchend', clear, { once: true });
                      document.addEventListener('touchmove', clear, { once: true });
                    } : undefined;
                    return (
                  <div
                    key={msg.id}
                    className={`message ${msg.sender} ${msg.pending ? 'pending' : ''} ${msg.failed ? 'failed' : ''} ${canReply ? 'can-reply' : ''}`}
                    onDoubleClick={() => canReply && setReplyTo(msg)}
                    onContextMenu={(e) => {
                      if (!canReply) return;
                      e.preventDefault();
                      e.stopPropagation();
                      messageActionRefs.current[msg.id]?.current?.open();
                    }}
                    onTouchStart={onTouchStart}
                    title={canReply ? t('replyHint') || 'Double-click to reply' : undefined}
                  >
                    {msg.replyTo && (
                      <div className="message-reply">
                        <Reply size={12} />
                        <span>{msg.replyToText || t('message')}</span>
                      </div>
                    )}
                    <div className="message-bubble">
                      {(attachments[msg.id] || []).length > 0 && (
                        <div className="message-attachments">
                          {(attachments[msg.id] || []).map(att => (
                            <AttachmentView
                              key={att.id}
                              att={att}
                              t={t}
                              lang={language}
                              onPreview={setPreviewAtt}
                            />
                          ))}
                        </div>
                      )}
                      {msg.deleted ? (
                        <p className="message-text deleted"><AlertTriangle size={14} /> {t('messageDeleted')}</p>
                      ) : (
                        msg.text && <p className="message-text">{msg.text}</p>
                      )}
                      <span className="message-time">
                        {msg.pending ? '...' : msg.failed ? <AlertTriangle size={12} /> : null} {msg.timestamp}
                      </span>
                    </div>
                    {!msg.pending && !msg.deleted && (
                      <MessageActions
                        ref={messageActionRefs.current[msg.id] ||= { current: null }}
                        msg={msg}
                        isSavedChat={isSavedChat}
                        onCopy={() => { navigator.clipboard.writeText(msg.text || ''); showToast(t('copied'), 'info'); }}
                        onReply={() => setReplyTo(msg)}
                        onForward={() => { navigator.clipboard.writeText(msg.text || ''); showToast(t('forwardCopied'), 'info'); }}
                        onSaveToSaved={async () => {
                          await saveMessageToSaved(msg, attachments[msg.id] || []);
                          showToast(t('savedToSaved'), 'info');
                        }}
                        onDeleteForEveryone={async () => {
                          if (!window.confirm(t('confirmDeleteMessage'))) return;
                          await deleteMessageForEveryone(msg.id);
                          showToast(t('messageDeletedOk'), 'info');
                        }}
                        t={t}
                      />
                    )}
                  </div>
                    );
                  })}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {replyTo && (
              <div className="reply-preview">
                <Reply size={14} />
                <div className="reply-preview-info">
                  <span className="reply-preview-label">{t('replyTo')}</span>
                  <span className="reply-preview-text">{replyTo.text || t('attachment')}</span>
                </div>
                <button className="icon-btn-small" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
                  <X size={14} />
                </button>
              </div>
            )}

            <div className="chat-input-container">
              <button
                className="icon-btn"
                onClick={() => fileInputRef.current?.click()}
                aria-label={t('attachFile')}
              >
                <Paperclip size={20} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={handleFilePick}
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.zip,.rar"
              />
              <textarea
                className="chat-input"
                placeholder={isBlocked ? t('blocked') : t('typeMessage')}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                rows="1"
                disabled={!activeChat || isBlocked}
              />
              <button
                className="send-btn"
                onClick={handleSendMessage}
                disabled={!inputValue.trim() || !activeChat || sending}
                aria-label={t('send')}
              >
                <Send size={20} />
              </button>
            </div>
          </>
        )}
      </main>

      {sidebarOpen && <div className="mobile-overlay" onClick={() => setSidebarOpen(false)} />}

      {toast && (
        <div className={`toast toast-${toast.kind}`}>{toast.text}</div>
      )}

      {previewAtt && (
        <AttachmentPreview
          att={previewAtt}
          t={t}
          onClose={() => setPreviewAtt(null)}
        />
      )}

      <SettingsWindow
        isOpen={showSettingsWindow}
        onClose={handleCloseSettingsWindow}
        settings={appSettings}
        onSettingsChange={handleSettingsChange}
        language={language}
        onLanguageChange={setLanguage}
        t={t}
      />

      {showProfile && (
        <ProfileModal
          session={session}
          profile={myProfile}
          onClose={() => setShowProfile(false)}
          onUpdated={(updated) => {
            setMyProfile(updated);
            // pick up any avatar/name changes another user made next time list loads
            loadContacts();
          }}
        />
      )}
    </div>
  );
}

// helper components defined out-of-render to avoid remount churn
function AttachmentView({ att, t, lang, onPreview }) {
  const icon = att.kind === 'image' ? <ImageIcon size={18} />
    : att.kind === 'video' ? <Video size={18} />
    : att.kind === 'audio' ? <Music size={18} />
    : <FileText size={18} />;
  const name = att.file_name || t('file');
  const canPreview = att.kind === 'image' || att.kind === 'video'
    || (att.mime_type && /\.(png|jpe?g|gif|webp|svg|bmp|ico|heic|heif|avif)$/i.test(att.file_name || ''))
    || (att.mime_type || '').startsWith('image/')
    || (att.mime_type || '').startsWith('video/');
  const handlePreview = (e) => {
    if (!canPreview) return;
    e.preventDefault();
    e.stopPropagation();
    onPreview?.(att);
  };
  if (att.kind === 'image' || (att.mime_type || '').startsWith('image/')) {
    return (
      <button
        type="button"
        className="attachment attachment-image"
        onClick={handlePreview}
        title={name}
      >
        <img src={att.url} alt={name} loading="lazy" />
        <span className="attachment-image-zoom" aria-hidden><ZoomIn size={14} /></span>
      </button>
    );
  }
  if (att.kind === 'video' || (att.mime_type || '').startsWith('video/')) {
    return (
      <div className="attachment attachment-video-wrap">
        <video className="attachment attachment-video" src={att.url} controls preload="metadata" />
        <button
          type="button"
          className="attachment-preview-btn"
          onClick={handlePreview}
          title={t('preview') || 'Preview'}
          aria-label={t('preview') || 'Preview'}
        >
          <ZoomIn size={14} />
        </button>
      </div>
    );
  }
  if (att.kind === 'audio' || (att.mime_type || '').startsWith('audio/')) {
    return <audio className="attachment attachment-audio" src={att.url} controls preload="metadata" />;
  }
  return (
    <div className="attachment attachment-file" title={name}>
      <span className="attachment-file-icon" aria-hidden>{icon}</span>
      <div className="attachment-file-info">
        <span className="attachment-file-name">{name}</span>
        <span className="attachment-file-size">{formatBytes(att.size_bytes, lang)}</span>
      </div>
      <button
        type="button"
        className="attachment-download-btn"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); downloadAttachment(att); }}
        title={t('download') || 'Download'}
        aria-label={t('download') || 'Download'}
      >
        <Download size={16} />
      </button>
    </div>
  );
}

// Fetch a cross-origin Supabase URL and save it as a blob so the
// browser's download uses the original file_name (the public URL
// doesn't carry Content-Disposition, so a plain `<a download>` would
// otherwise fall back to the URL's last path segment).
async function downloadAttachment(att) {
  try {
    const res = await fetch(att.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = att.file_name || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (err) {
    // Fallback: open in a new tab so the user can save manually.
    console.error('download failed, opening in new tab:', err);
    window.open(att.url, '_blank', 'noopener,noreferrer');
  }
}

function AttachmentPreview({ att, t, onClose }) {
  // Close on ESC.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Close only when the user clicks the backdrop itself, not when a
  // click bubbles up from the toolbar/stage. Track where the mousedown
  // started — if it began on the overlay (not a descendant), it's a
  // backdrop click and we close.
  const overlayRef = useRef(null);
  const handleMouseDown = (e) => {
    if (e.target === overlayRef.current) {
      // mark that the next click on the overlay should close
      e.currentTarget.dataset.backdrop = '1';
    }
  };
  const handleClick = (e) => {
    if (e.currentTarget.dataset.backdrop === '1') {
      delete e.currentTarget.dataset.backdrop;
      onClose();
    }
  };
  const name = att.file_name || t('file') || 'file';
  const isVideo = att.kind === 'video' || (att.mime_type || '').startsWith('video/');
  return (
    <div
      ref={overlayRef}
      className="attachment-preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('preview') || 'Preview'}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      <div className="attachment-preview-toolbar" onClick={(e) => e.stopPropagation()}>
        <span className="attachment-preview-name" title={name}>{name}</span>
        <div className="attachment-preview-actions">
          <button
            type="button"
            className="attachment-preview-action"
            onClick={() => downloadAttachment(att)}
            title={t('download') || 'Download'}
            aria-label={t('download') || 'Download'}
          >
            <Download size={18} />
          </button>
          <button
            type="button"
            className="attachment-preview-action"
            onClick={onClose}
            title={t('close') || 'Close'}
            aria-label={t('close') || 'Close'}
          >
            <XIcon size={18} />
          </button>
        </div>
      </div>
      <div className="attachment-preview-stage" onClick={(e) => e.stopPropagation()}>
        {isVideo ? (
          <video className="attachment-preview-media" src={att.url} controls autoPlay />
        ) : (
          <img className="attachment-preview-media" src={att.url} alt={name} />
        )}
      </div>
    </div>
  );
}

function formatBytes(n, lang) {
  if (n === 0 || n == null) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(n);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const locale = lang === 'ru' ? 'ru-RU' : lang === 'uk' ? 'uk-UA' : 'en-US';
  // 0 decimals for whole bytes, 1 decimal for KB/MB, 2 decimals for GB/TB.
  const fractionDigits = unit === 0 ? 0 : (value >= 100 ? 0 : unit >= 3 ? 2 : 1);
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
  return `${formatted} ${units[unit]}`;
}

// forwarding helper used by MessageActions
// Saves a message into the user's private "Saved Messages" store,
// carrying over attachments so images/files round-trip with the note.
async function saveMessageToSaved(msg, attachments = []) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const firstAtt = attachments[0];
  const kind = firstAtt
    ? (firstAtt.kind === 'image' ? 'image'
       : firstAtt.kind === 'video' ? 'video'
       : firstAtt.kind === 'audio' ? 'document'
       : 'document')
    : (msg.text ? 'note' : 'forward');
  await supabase.from('saved_messages').insert({
    user_id: session.user.id,
    kind,
    text: msg.text || null,
    url: firstAtt?.url || null,
    file_name: firstAtt?.file_name || null,
    mime_type: firstAtt?.mime_type || null,
    size_bytes: firstAtt?.size_bytes || null,
  });
}

// Avatar: img if src exists, otherwise a Discord-style default avatar.
// The default is a single-letter monogram on a deterministic color
// picked from a small palette indexed by a hash of the name, so every
// new user gets one of a handful of colors and the choice is stable
// across sessions and devices. Adding ?v= to src busts the HTTP cache
// so freshly uploaded avatars appear immediately.
const DEFAULT_AVATAR_COLORS = [
  '#1abc9c', '#3498db', '#9b59b6', '#e91e63',
  '#f1c40f', '#e67e22', '#e74c3c', '#2ecc71',
];

function defaultAvatarColor(seed = '') {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return DEFAULT_AVATAR_COLORS[hash % DEFAULT_AVATAR_COLORS.length];
}

function Avatar({ src, name = '', size = 40, className }) {
  const letter = (name || '?').trim()[0]?.toUpperCase() || '?';
  // Bust cache ONLY when `src` changes (avatar re-upload), not every render.
  // Re-rendering with a new Date.now() URL causes every avatar to be
  // re-fetched on each parent state update.
  const url = useMemo(() => {
    if (!src) return null;
    const sep = src.includes('?') ? '&' : '?';
    return `${src}${sep}v=${Date.now().toString(36)}`;
  }, [src]);
  const [errored, setErrored] = useState(false);
  useEffect(() => { setErrored(false); }, [src]);

  if (url && !errored) {
    return (
      <img
        src={url}
        alt={name}
        className={className}
        style={{ width: size, height: size, objectFit: 'cover' }}
        onError={() => setErrored(true)}
      />
    );
  }
  return (
    <div
      className={className}
      aria-label={name}
      style={{
        width: size,
        height: size,
        background: defaultAvatarColor(name),
        color: '#fff',
        fontSize: Math.max(11, Math.round(size * 0.46)),
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        userSelect: 'none',
        flexShrink: 0,
        letterSpacing: '0.02em',
      }}
    >
      {letter}
    </div>
  );
}

export default App;
