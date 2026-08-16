import {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import {
  Plus, Pin, PinOff, Trash2, Link as LinkIcon, Pencil, Clock, Bell, ListChecks, FileText, Image as ImageIcon, Video, Music, File as FileIcon, X, Search, Bookmark,
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import {
  loadSavedMessages, createSavedMessage, deleteSavedMessage, togglePinSavedMessage, markReminded, uploadAttachment, detectKind,
} from '../lib/messaging';
import './SavedMessages.css';

const KINDS = [
  { id: 'note',     label: 'Note',     icon: Pencil,     hint: 'Write a private note' },
  { id: 'link',     label: 'Link',     icon: LinkIcon,   hint: 'Save a link' },
  { id: 'reminder', label: 'Reminder', icon: Clock,      hint: 'Set a reminder' },
  { id: 'file',     label: 'File',     icon: FileText,   hint: 'Upload a file' },
];

const SavedMessages = forwardRef(function SavedMessages({ userId, onToast, t }, ref) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(null); // { kind }
  const [query, setQuery] = useState('');
  const [banner, setBanner] = useState(null);
  const [highlightId, setHighlightId] = useState(null);
  const listRef = useRef(null);
  const itemRefs = useRef({});
  const fileInputRef = useRef(null);
  const tickRef = useRef(null);
  // Hold items in a ref so the reminder interval doesn't restart on every refresh.
  const itemsRef = useRef([]);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const refresh = async () => {
    const { data, error } = await loadSavedMessages(userId);
    if (error) {
      onToast?.(t('errorLoadSaved') || 'Failed to load saved messages', 'error');
    } else {
      setItems(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!userId) return;
    refresh();
    const ch = supabase
      .channel(`saved-${userId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'saved_messages', filter: `user_id=eq.${userId}` },
        () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  // tick every 30s to surface reminders whose time is now
  useEffect(() => {
    tickRef.current = setInterval(() => {
      const now = Date.now();
      const due = itemsRef.current.find(i => i.remind_at && !i.reminded && new Date(i.remind_at).getTime() <= now);
      if (due) {
        setBanner(due);
        markReminded(due.id, userId);
      }
    }, 30 * 1000);
    return () => { clearInterval(tickRef.current); tickRef.current = null; };
  }, [userId]);

  useImperativeHandle(ref, () => ({
    openComposer: (kind = 'note') => setComposing({ kind }),
  }));

  const handleCreate = async (payload) => {
    const { error } = await createSavedMessage({ userId, ...payload });
    if (error) {
      onToast?.(t('errorSaveItem') || 'Failed to save', 'error');
    } else {
      setComposing(null);
      onToast?.(t('savedOk') || 'Saved', 'info');
    }
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { onToast?.(t('errorFileSize'), 'error'); return; }
    const { data: up, error } = await uploadAttachment(file, userId);
    if (error || !up) { onToast?.(t('errorUpload'), 'error'); return; }
    await handleCreate({
      kind: detectKind(file),
      url: up.url,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });
  };

  const handleDelete = async (id) => {
    if (!window.confirm(t('confirmDeleteItem') || 'Delete this item?')) return;
    const { error } = await deleteSavedMessage(id, userId);
    if (!error) onToast?.(t('deletedOk') || 'Deleted', 'info');
  };

  const handlePin = async (item) => {
    const { error } = await togglePinSavedMessage(item.id, userId, item.pinned);
    if (error) onToast?.(t('errorPin'), 'error');
  };

  const focusReminderItem = (id) => {
    const node = itemRefs.current[id];
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightId(id);
      // brief flash, then clear
      setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 1800);
    }
    setBanner(null);
  };

  const visible = items.filter(i => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (i.text || '').toLowerCase().includes(q)
      || (i.url || '').toLowerCase().includes(q)
      || (i.file_name || '').toLowerCase().includes(q);
  });

  return (
    <div className="saved-messages">
      {banner && (
        <button
          type="button"
          className="reminder-banner"
          onClick={() => focusReminderItem(banner.id)}
          title={t('openReminder') || 'Open reminder'}
        >
          <Bell size={16} />
          <div className="reminder-banner-text">
            <strong>{t('reminder') || 'Reminder'}</strong>
            <span>{banner.text || banner.url || banner.file_name || t('reminder')}</span>
          </div>
          <span
            className="icon-btn-small"
            role="button"
            aria-label={t('dismiss') || 'Dismiss'}
            onClick={(e) => { e.stopPropagation(); setBanner(null); }}
          >
            <X size={14} />
          </span>
        </button>
      )}

      <div className="saved-toolbar">
        <div className="saved-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search') || 'Search'}
          />
        </div>
        <div className="saved-add">
          {KINDS.map(k => {
            const Icon = k.icon;
            if (k.id === 'file') {
              return (
                <button key={k.id} className="add-pill" title={k.hint} onClick={() => fileInputRef.current?.click()}>
                  <Icon size={16} />
                </button>
              );
            }
            return (
              <button key={k.id} className="add-pill" title={k.hint} onClick={() => setComposing({ kind: k.id })}>
                <Icon size={16} />
              </button>
            );
          })}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt"
            style={{ display: 'none' }}
            onChange={handleFile}
          />
        </div>
      </div>

      <div className="saved-list" ref={listRef}>
        {loading && <div className="empty-state">...</div>}
        {!loading && visible.length === 0 && (
          <div className="empty-state">
            <Bookmark size={28} />
            <p>{query ? t('noResults') : (t('savedEmpty') || 'Nothing saved yet — add a note, link or reminder.')}</p>
          </div>
        )}
        {visible.map(item => (
          <SavedItem
            key={item.id}
            item={item}
            onDelete={handleDelete}
            onPin={handlePin}
            t={t}
            highlight={highlightId === item.id}
            registerRef={(node) => {
              if (node) itemRefs.current[item.id] = node;
              else delete itemRefs.current[item.id];
            }}
          />
        ))}
      </div>

      {composing && (
        <Composer
          kind={composing.kind}
          onCancel={() => setComposing(null)}
          onSubmit={handleCreate}
          t={t}
        />
      )}
    </div>
  );
});

function SavedItem({ item, onDelete, onPin, t, highlight, registerRef }) {
  const Icon = item.kind === 'link' ? LinkIcon
    : item.kind === 'reminder' ? Clock
    : item.kind === 'image' ? ImageIcon
    : item.kind === 'video' ? Video
    : item.kind === 'audio' ? Music
    : item.kind === 'file' ? FileText
    : item.kind === 'forward' ? Bookmark
    : Pencil;

  const renderBody = () => {
    if (item.kind === 'image' && item.url) {
      return <a href={item.url} target="_blank" rel="noreferrer"><img className="saved-image" src={item.url} alt={item.file_name || ''} /></a>;
    }
    if (item.kind === 'video' && item.url) {
      return <video className="saved-video" src={item.url} controls preload="metadata" />;
    }
    if (item.kind === 'audio' && item.url) {
      return <audio className="saved-audio" src={item.url} controls preload="metadata" />;
    }
    if (item.kind === 'link' && item.url) {
      return <a className="saved-link" href={item.url} target="_blank" rel="noreferrer">{item.text || item.url}</a>;
    }
    if (item.file_name) {
      return (
        <a className="saved-file" href={item.url} target="_blank" rel="noreferrer">
          <FileIcon size={18} />
          <div>
            <div className="saved-file-name">{item.file_name}</div>
            {item.text && <div className="saved-file-caption">{item.text}</div>}
          </div>
        </a>
      );
    }
    return <p className="saved-text">{item.text}</p>;
  };

  const reminderLabel = item.remind_at
    ? new Date(item.remind_at).toLocaleString(
        (typeof localStorage !== 'undefined' && localStorage.getItem('language')) || navigator.language || 'en-US',
        { dateStyle: 'medium', timeStyle: 'short' }
      )
    : null;

  return (
    <div
      ref={registerRef}
      className={`saved-item ${item.pinned ? 'pinned' : ''} ${highlight ? 'highlight' : ''}`}
    >
      <div className="saved-item-icon"><Icon size={16} /></div>
      <div className="saved-item-body">
        {renderBody()}
        <div className="saved-item-meta">
          <span>{new Date(item.created_at).toLocaleDateString()}</span>
          {reminderLabel && (
            <span className="saved-item-remind">
              <Clock size={12} /> {reminderLabel}
            </span>
          )}
        </div>
      </div>
      <div className="saved-item-actions">
        <button className="icon-btn-small" title={item.pinned ? t('unpin') : t('pin')} onClick={() => onPin(item)}>
          {item.pinned ? <PinOff size={14} /> : <Pin size={14} />}
        </button>
        <button className="icon-btn-small" title={t('delete')} onClick={() => onDelete(item.id)}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function Composer({ kind, onCancel, onSubmit, t }) {
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [remindAt, setRemindAt] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = () => {
    if (kind === 'note' && !text.trim()) return;
    if (kind === 'link' && !url.trim()) return;
    if (kind === 'reminder' && (!text.trim() || !remindAt)) return;
    onSubmit({
      kind,
      text: text.trim() || null,
      url: url.trim() || null,
      remindAt: remindAt ? new Date(remindAt).toISOString() : null,
    });
  };

  return (
    <div className="composer-overlay" onClick={onCancel}>
      <div className="composer-card" onClick={(e) => e.stopPropagation()}>
        <div className="composer-header">
          <h3>
            {kind === 'note' && (t('composerNote') || 'New note')}
            {kind === 'link' && (t('composerLink') || 'New link')}
            {kind === 'reminder' && (t('composerReminder') || 'New reminder')}
          </h3>
          <button className="icon-btn" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="composer-body">
          {kind === 'note' && (
            <textarea
              ref={inputRef}
              rows={5}
              placeholder={t('composerNoteHint') || 'Write a private note...'}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
          {kind === 'link' && (
            <>
              <input
                ref={inputRef}
                type="text"
                placeholder={t('composerLinkTitle') || 'Title (optional)'}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <input
                type="url"
                placeholder="https://..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </>
          )}
          {kind === 'reminder' && (
            <>
              <input
                ref={inputRef}
                type="text"
                placeholder={t('composerReminderText') || 'What to remember?'}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <input
                type="datetime-local"
                value={remindAt}
                onChange={(e) => setRemindAt(e.target.value)}
              />
            </>
          )}
        </div>
        <div className="composer-footer">
          <button className="login-button" onClick={submit}>
            {t('save') || 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SavedMessages;
