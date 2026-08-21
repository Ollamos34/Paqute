import { useEffect } from 'react';
import {
  Star, Bell, BellOff, Trash2, UserX, UserCheck, Info,
} from 'lucide-react';
import './ChatMenu.css';

function ChatMenu({
  isSaved, isBlocked, isMuted, isFavorite,
  onToggleBlock, onToggleMute, onClear, onDelete, onToggleFavorite,
  onClose, t, floating = false, position = null,
}) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={`chat-menu ${floating ? 'chat-menu-floating' : ''}`} role="menu" style={floating ? position : undefined}>
      {!isSaved && (
        <button className="chat-menu-item" role="menuitem" onClick={onToggleFavorite}>
          <Star size={16} fill={isFavorite ? 'currentColor' : 'none'} />
          <span>{isFavorite ? t('removeFromFavorites') : t('addToFavorites')}</span>
        </button>
      )}
      {!isSaved && (
        <button className="chat-menu-item" role="menuitem" onClick={onToggleMute}>
          {isMuted ? <Bell size={16} /> : <BellOff size={16} />}
          <span>{isMuted ? t('unmute') : t('mute')}</span>
        </button>
      )}
      {!isSaved && (
        <button className="chat-menu-item" role="menuitem" onClick={onToggleBlock}>
          {isBlocked ? <UserCheck size={16} /> : <UserX size={16} />}
          <span>{isBlocked ? t('unblock') : t('block')}</span>
        </button>
      )}
      {!isSaved && (
        <button className="chat-menu-item" role="menuitem" onClick={onClear}>
          <Trash2 size={16} />
          <span>{t('clearChat')}</span>
        </button>
      )}
      {!isSaved && (
        <button className="chat-menu-item danger" role="menuitem" onClick={onDelete}>
          <Trash2 size={16} />
          <span>{t('deleteChat')}</span>
        </button>
      )}
      {isSaved && (
        <div className="chat-menu-info">
          <Info size={14} />
          <span>{t('savedHint')}</span>
        </div>
      )}
    </div>
  );
}

export default ChatMenu;
