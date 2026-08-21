import { useState, useEffect, useLayoutEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Copy, Reply, Forward, Bookmark, Trash2, MoreHorizontal, RotateCcw } from 'lucide-react';
import './MessageActions.css';

const MessageActions = forwardRef(function MessageActions({ msg, isSavedChat, isFailed, onCopy, onReply, onRetry, onForward, onSaveToSaved, onDeleteForEveryone, t }, forwardedRef) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const ref = useRef(null);

  useImperativeHandle(forwardedRef, () => ({
    open: () => {
      setPosition(null);
      setOpen(true);
    },
    openAt: (x, y) => {
      setPosition({ x, y });
      setOpen(true);
    },
    close: () => {
      setPosition(null);
      setOpen(false);
    },
  }), []);

  useLayoutEffect(() => {
    if (!open || !position || !ref.current) return;

    const rect = ref.current.getBoundingClientRect();
    const margin = 10;
    const nextX = Math.max(
      margin,
      Math.min(position.x, window.innerWidth - rect.width - margin),
    );
    const nextY = Math.max(
      margin,
      Math.min(position.y, window.innerHeight - rect.height - margin),
    );

    if (nextX !== position.x || nextY !== position.y) {
      setPosition({ x: nextX, y: nextY });
    }
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setPosition(null);
        setOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') { setPosition(null); setOpen(false); } };
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
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setPosition({ x: rect.left, y: rect.bottom + 8 });
          setOpen(true);
        }}
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
      style={position ? { left: position.x, top: position.y } : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      {isFailed && (
        <button className="message-action" role="menuitem" onClick={() => { onRetry(); setOpen(false); }} title={t('retry') || 'Retry'}>
          <RotateCcw size={14} /> <span>{t('retry') || 'Retry'}</span>
        </button>
      )}
      <button className="message-action" role="menuitem" onClick={() => { onCopy(); setOpen(false); }} title={t('copy')}>
        <Copy size={14} /> <span>{t('copy')}</span>
      </button>
      {!isSavedChat && !isFailed && (
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
      {msg.sender === 'me' && !isFailed && (
        <button className="message-action danger" role="menuitem" onClick={() => { onDeleteForEveryone(); setOpen(false); }} title={t('deleteForEveryone')}>
          <Trash2 size={14} /> <span>{t('deleteForEveryone')}</span>
        </button>
      )}
    </div>
  );
});

export default MessageActions;
