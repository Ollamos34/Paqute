import { useState } from 'react';
import { supabase } from './supabaseClient';
import { getTranslation } from './i18n';
import './Login.css';

function Login() {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [infoMessage, setInfoMessage] = useState('');
  const [language] = useState(() => {
    try { return localStorage.getItem('language') || 'en'; } catch { return 'en'; }
  });

  const t = (key) => getTranslation(language, key);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfoMessage('');
    setLoading(true);

    try {
      if (mode === 'signup') {
        const cleanUsername = (username || email.split('@')[0]).trim().slice(0, 32);
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { username: cleanUsername } }
        });
        if (error) {
          setError(error.message);
        } else {
          setInfoMessage(
            language === 'ru'
              ? 'Проверь почту — Supabase мог отправить письмо для подтверждения.'
              : language === 'uk'
              ? 'Перевір пошту — Supabase міг надіслати лист для підтвердження.'
              : 'Check your email — Supabase may have sent a confirmation message.'
          );
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setError(error.message);
      }
    } catch (err) {
      setError(err?.message || 'Unexpected error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">
          <div className="login-logo" aria-hidden>φ</div>
          <h1 className="login-title">{mode === 'signin' ? t('signIn') : t('signUp')}</h1>
          <p className="login-subtitle">
            {mode === 'signin'
              ? (language === 'ru' ? 'С возвращением' : language === 'uk' ? 'З поверненням' : 'Welcome back')
              : (language === 'ru' ? 'Создайте новый аккаунт' : language === 'uk' ? 'Створіть новий акаунт' : 'Create a new account')}
          </p>
        </div>

        {mode === 'signup' && (
          <div className="login-field">
            <label className="login-field-label">{t('username')}</label>
            <input
              className="login-input"
              type="text"
              placeholder={t('username')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
            <span className="login-field-rule" />
          </div>
        )}

        <div className="login-field">
          <label className="login-field-label">{t('email')}</label>
          <input
            className="login-input"
            type="email"
            placeholder={t('email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <span className="login-field-rule" />
        </div>
        <div className="login-field">
          <label className="login-field-label">{t('password')}</label>
          <input
            className="login-input"
            type="password"
            placeholder={t('password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          />
          <span className="login-field-rule" />
        </div>

        {error && <p className="login-error">{error}</p>}
        {infoMessage && <p className="login-info">{infoMessage}</p>}

        <button className="login-button" type="submit" disabled={loading}>
          {loading
            ? '...'
            : (mode === 'signin' ? t('signIn') : t('signUp'))}
        </button>

        <button
          type="button"
          className="login-switch-btn"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError('');
            setInfoMessage('');
            setUsername('');
          }}
        >
          {mode === 'signin' ? t('noAccount') : t('haveAccount')}
        </button>
      </form>
    </div>
  );
}

export default Login;
