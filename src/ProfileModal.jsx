import { useState, useRef } from 'react';
import { X, Camera, Loader2 } from 'lucide-react';
import { supabase } from './supabaseClient';

// Usage: <ProfileModal session={session} profile={myProfile} onClose={...} onUpdated={(p) => setMyProfile(p)} />
function ProfileModal({ session, profile, onClose, onUpdated }) {
  const [username, setUsername] = useState(profile?.username || '');
  const [avatarPreview, setAvatarPreview] = useState(profile?.avatar_url || null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Выбери файл изображения (jpg, png, webp и т.п.)');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Файл слишком большой (максимум 5 МБ)');
      return;
    }

    setError('');
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const handleSave = async () => {
    setError('');

    if (!username.trim() || username.trim().length < 1) {
      setError('Имя пользователя не может быть пустым');
      return;
    }

    setSaving(true);

    try {
      let avatarUrl = profile?.avatar_url || null;

      // 1. Upload new avatar if one was picked
      if (avatarFile) {
        const ext = avatarFile.name.split('.').pop();
        const path = `${session.user.id}/avatar.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(path, avatarFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
          .from('avatars')
          .getPublicUrl(path);

        avatarUrl = publicUrlData.publicUrl;
      }

      // 2. Update profile row
      const { data, error: updateError } = await supabase
        .from('profiles')
        .update({
          username: username.trim(),
          avatar_url: avatarUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', session.user.id)
        .select()
        .single();

      if (updateError) throw updateError;

      onUpdated?.(data);
      onClose();
    } catch (err) {
      // Unique username collisions land here (Postgres unique_violation = 23505)
      if (err.code === '23505') {
        setError('Это имя пользователя уже занято');
      } else {
        setError(err.message || 'Не удалось сохранить профиль');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Профиль</h2>
          <button style={styles.closeBtn} onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        <div style={styles.avatarSection}>
          <div
            style={styles.avatarWrapper}
            onClick={() => fileInputRef.current?.click()}
          >
            {avatarPreview ? (
              <img src={avatarPreview} alt="avatar" style={styles.avatarImg} />
            ) : (
              <div style={styles.avatarPlaceholder}>
                {username?.[0]?.toUpperCase() || '?'}
              </div>
            )}
            <div style={styles.avatarOverlay}>
              <Camera size={22} color="#fff" />
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <p style={styles.hint}>Нажми на фото, чтобы изменить</p>
        </div>

        <label style={styles.label}>Имя пользователя</label>
        <input
          style={styles.input}
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Твоё имя"
        />

        {error && <p style={styles.error}>{error}</p>}

        <button style={styles.saveBtn} onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 size={18} className="spin" /> : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    width: 360, background: '#1a1d24', borderRadius: 16, padding: 24,
    display: 'flex', flexDirection: 'column', gap: 14,
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#fff', fontSize: 18, margin: 0 },
  closeBtn: {
    background: 'none', border: 'none', color: '#9aa0ab', cursor: 'pointer',
    display: 'flex', padding: 4,
  },
  avatarSection: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  avatarWrapper: {
    position: 'relative', width: 96, height: 96, borderRadius: '50%',
    cursor: 'pointer', overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%', objectFit: 'cover' },
  avatarPlaceholder: {
    width: '100%', height: '100%', borderRadius: '50%',
    background: '#2563EB', color: '#fff', fontSize: 32, fontWeight: 600,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  avatarOverlay: {
    position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    opacity: 0, transition: 'opacity 0.15s',
  },
  hint: { color: '#9aa0ab', fontSize: 12, margin: 0 },
  label: { color: '#9aa0ab', fontSize: 13 },
  input: {
    padding: '10px 12px', borderRadius: 8, border: '1px solid #333',
    background: '#22252d', color: '#fff', fontSize: 14,
  },
  error: { color: '#ff6b6b', fontSize: 13, margin: 0 },
  saveBtn: {
    padding: '10px 12px', borderRadius: 8, border: 'none',
    background: '#2563EB', color: '#fff', fontSize: 14, fontWeight: 600,
    cursor: 'pointer', marginTop: 6,
  },
};

export default ProfileModal;
