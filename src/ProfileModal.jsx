import { useState, useRef } from 'react';
import { X, Camera, Loader2 } from 'lucide-react';
import { supabase } from './supabaseClient';
import './ProfileModal.css';

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
      setError('Please choose an image file (jpg, png, webp, etc.)');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('File is too large (max 5 MB)');
      return;
    }

    setError('');
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const handleSave = async () => {
    setError('');

    if (!username.trim()) {
      setError('Username cannot be empty');
      return;
    }

    setSaving(true);

    try {
      let avatarUrl = profile?.avatar_url || null;

      // 1. Upload new avatar if one was picked.
      // Use a unique path so each upload replaces the previous file
      // in storage and the browser cache is naturally busted.
      if (avatarFile) {
        const ext = (avatarFile.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${session.user.id}/${Date.now()}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(path, avatarFile, { upsert: false });

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
          .from('avatars')
          .getPublicUrl(path);

        avatarUrl = publicUrlData.publicUrl;
      }

      // 2. Update profile row.
      const { data, error: updateError } = await supabase
        .from('profiles')
        .update({
          username: username.trim(),
          avatar_url: avatarUrl,
        })
        .eq('id', session.user.id)
        .select()
        .single();

      if (updateError) throw updateError;

      onUpdated?.(data);
      onClose();
    } catch (err) {
      if (err.code === '23505') {
        setError('That username is already taken');
      } else {
        setError(err.message || 'Could not save profile');
      }
    } finally {
      setSaving(false);
    }
  };

  const letter = (username?.[0] || '?').toUpperCase();

  return (
    <div className="profile-overlay" onClick={onClose}>
      <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="profile-header">
          <h2 className="profile-title">Profile</h2>
          <button className="profile-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="profile-avatar-section">
          <div
            className="profile-avatar-wrap"
            onClick={() => fileInputRef.current?.click()}
          >
            {avatarPreview ? (
              <img src={avatarPreview} alt="avatar" />
            ) : (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--color-primary)', color: 'var(--color-on-primary)',
                fontSize: 36, fontWeight: 600,
              }}>
                {letter}
              </div>
            )}
            <div className="profile-avatar-overlay">
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
          <p className="profile-hint">Click the photo to change it</p>
        </div>

        <label className="profile-label">Username</label>
        <input
          className="profile-input"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Your name"
        />

        {error && <p className="profile-error">{error}</p>}

        <button className="profile-save" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 size={18} className="spin" /> : 'Save'}
        </button>
      </div>
    </div>
  );
}

export default ProfileModal;
