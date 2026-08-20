import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Copy, Reply, Forward, Bookmark, Trash2, MoreHorizontal } from 'lucide-react';
import './MessageActions.css';

const MessageActions = forwardRef(function MessageActions({ msg, isSavedChat, onCopy, onReply, onForward, onSaveToSaved, onDeleteForEveryone, t }, forwardedRef) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useImperativeHandle(forwardedRef, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        className="message-actions-toggle"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        aria-label={t('more')}
        aria-expanded={false}
        aria-haspopup="menu"
        title={t('more')}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
    );
  }

  return (
    <div
      className="message-actions"
      role="menu"
      ref={ref}
      onClick={(e) => e.stopPropagation()}
    >
      <button className="message-action" role="menuitem" onClick={() => { onCopy(); setOpen(false); }} title={t('copy')}>
        <Copy size={14} /> <span>{t('copy')}</span>
      </button>
      {!isSavedChat && (
        <button className="message-action" role="menuitem" onClick={() => { onReply(); setOpen(false); }} title={t('reply')}>
          <Reply size={14} /> <span>{t('reply')}</span>
        </button>
      )}
      <button className="message-action" role="menuitem" onClick={() => { onForward(); setOpen(false); }} title={t('forward')}>
        <Forward size={14} /> <span>{t('forward')}</span>
      </button>
      <button className="message-action" role="menuitem" onClick={() => { onSaveToSaved(); setOpen(false); }} title={t('saveToSaved')}>
        <Bookmark size={14} /> <span>{t('saveToSaved')}</span>
      </button>
      {msg.sender === 'me' && (
        <button className="message-action danger" role="menuitem" onClick={() => { onDeleteForEveryone(); setOpen(false); }} title={t('deleteForEveryone')}>
          <Trash2 size={14} /> <span>{t('deleteForEveryone')}</span>
        </button>
      )}
    </div>
  );
});

export default MessageActions;
