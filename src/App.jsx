import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Paperclip, Search, MoreVertical, Moon, Sun, Menu, X, Star, Settings, LogOut, Check, Bookmark, Reply, AlertTriangle, FileText, Image as ImageIcon, Video, Music } from 'lucide-react';
import { getTranslation } from './i18n';
import SettingsWindow from './components/SettingsWindow';
import ChatMenu from './components/ChatMenu';
import SavedMessages from './components/SavedMessages';
import MessageActions from './components/MessageActions';
import { supabase } from './supabaseClient';
import {
  getOrCreateChat, loadMessages, sendMessage as sendMessageDb,
  loadAttachments, uploadAttachment, detectKind,
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
  const [mutedChats, setMutedChats] = useState([]); // chatIds I have muted
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [toast, setToast] = useState(null); // { kind:'info'|'error', text }
  const messageChannelRef = useRef(null);
  const fileInputRef = useRef(null);
  const savedItemsRef = useRef(null); // imperative ref for SavedMessages panel

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
          avatar: p.avatar_url || `https://i.pravatar.cc/150?u=${p.id}`,
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
      // auto-pick first contact once we have any
      setActiveChat(prev => {
        if (prev) return prev;
        return null;
      });
    });

    return () => { cancelled = true; };
  }, [session, loadContacts]);

  // pick first contact once contacts load (separate so it doesn't re-fire on activeChat change)
  useEffect(() => {
    if (!session || activeChat) return;
    if (contacts.length > 0) setActiveChat(contacts[0].id);
  }, [contacts, activeChat, session]);

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
            setMessages(prev => {
              const list = prev[activeChat] || [];
              // 1) If we already have a row by id (Postgres echoes our
              //    own insert), swap the optimistic row in place so we
              //    keep the user's pending state (e.g. attachments).
              if (shapedMsg.clientId) {
                const idx = list.findIndex(
                  x => x.clientId === shapedMsg.clientId && x.pending
                );
                if (idx !== -1) {
                  const next = list.slice();
                  // Spread optimistic first, then shapedMsg, so the
                  // canonical id/timestamp win but pending attachments
                  // already on the optimistic row survive.
                  next[idx] = {
                    ...next[idx],
                    ...shapedMsg,
                    pending: false,
                    failed: false,
                  };
                  return { ...prev, [activeChat]: next };
                }
              }
              // 2) Otherwise, dedupe by id.
              if (list.some(existing => existing.id === shapedMsg.id)) return prev;
              return { ...prev, [activeChat]: [...list, shapedMsg] };
            });
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
    setReplyTo(null);

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
      return null;
    }

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
      for (const att of opts.attachments) {
        const { data: newAtt, error: attErr } = await supabase
          .from('message_attachments')
          .insert({
            message_id: real.id,
            kind: att.kind,
            url: att.url,
            file_name: att.fileName,
            mime_type: att.mimeType,
            size_bytes: att.sizeBytes,
          })
          .select().single();
        if (!attErr && newAtt) {
          setAttachments(prev => ({ ...prev, [real.id]: [...(prev[real.id] || []), newAtt] }));
        }
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
    // For simplicity: clear locally. Full delete needs a server-side RPC.
    const msgIds = (messages[activeChat] || []).map(m => m.id);
    setMessages(prev => ({ ...prev, [activeChat]: [] }));
    if (msgIds.length) {
      setAttachments(prev => {
        const next = { ...prev };
        for (const id of msgIds) delete next[id];
        return next;
      });
    }
    setContacts(prev => prev.filter(c => c.id !== activeChat));
    setFavorites(prev => prev.filter(id => id !== activeChat));
    setChatIdMap(prev => { const next = { ...prev }; delete next[activeChat]; return next; });
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
            <img
              src={myProfile?.avatar_url || `https://i.pravatar.cc/150?u=${session.user.id}`}
              alt={myProfile?.username || ''}
              className="profile-chip-avatar"
            />
            <span className="profile-chip-meta">
              <span className="profile-chip-name">{myProfile?.username || t('profile') || 'Профиль'}</span>
              <span className="profile-chip-sub">{t('chats')}</span>
            </span>
          </button>
          <div className="header-menu-wrapper" ref={headerMenuRef}>
            <button
              className="icon-btn"
              onClick={() => setShowHeaderMenu(v => !v)}
              aria-label={t('more') || 'Меню'}
              aria-expanded={showHeaderMenu}
              aria-haspopup="menu"
            >
              <MoreVertical size={20} />
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
                      <img src={chat.avatar} alt={chat.name} className="chat-avatar" />
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
                  <img src={activeContact?.avatar} alt={activeContact?.name} className="chat-avatar" />
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

        {isSavedChat ? (
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
                            <AttachmentView key={att.id} att={att} t={t} lang={language} />
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
                        msg={msg}
                        isSavedChat={isSavedChat}
                        onCopy={() => { navigator.clipboard.writeText(msg.text || ''); showToast(t('copied'), 'info'); }}
                        onReply={() => setReplyTo(msg)}
                        onForward={() => { navigator.clipboard.writeText(msg.text || ''); showToast(t('forwardCopied'), 'info'); }}
                        onSaveToSaved={async () => {
                          await saveMessageToSaved(msg);
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
function AttachmentView({ att, t, lang }) {
  const icon = att.kind === 'image' ? <ImageIcon size={18} />
    : att.kind === 'video' ? <Video size={18} />
    : att.kind === 'audio' ? <Music size={18} />
    : <FileText size={18} />;
  if (att.kind === 'image') {
    return <a className="attachment attachment-image" href={att.url} target="_blank" rel="noreferrer"><img src={att.url} alt={att.file_name || ''} /></a>;
  }
  if (att.kind === 'video') {
    return <video className="attachment attachment-video" src={att.url} controls preload="metadata" />;
  }
  if (att.kind === 'audio') {
    return <audio className="attachment attachment-audio" src={att.url} controls preload="metadata" />;
  }
  return (
    <a className="attachment attachment-file" href={att.url} target="_blank" rel="noreferrer">
      {icon}
      <div className="attachment-file-info">
        <span className="attachment-file-name">{att.file_name || t('file')}</span>
        <span className="attachment-file-size">{formatBytes(att.size_bytes, lang)}</span>
      </div>
    </a>
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
async function saveMessageToSaved(msg) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  await supabase.from('saved_messages').insert({
    user_id: session.user.id,
    kind: msg.text ? 'note' : 'forward',
    text: msg.text || null,
  });
}

export default App;
