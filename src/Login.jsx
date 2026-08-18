import { useState, useRef, useEffect } from 'react';
import { Eye, EyeOff, Mail, KeyRound, User as UserIcon, ArrowRight, Languages } from 'lucide-react';
import { supabase } from './supabaseClient';
import { getTranslation } from './i18n';
import './Login.css';

// Languages live in App.jsx too — keep them in sync if the order changes.
const LANGUAGES = [
  { id: 'en', label: 'English',  short: 'EN' },
  { id: 'uk', label: 'Українська', short: 'UK' },
  { id: 'ru', label: 'Русский',    short: 'RU' },
];

function Login() {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState(() => {
    try { return localStorage.getItem('language') || 'en'; } catch { return 'en'; }
  });

  // Keep i18n language in lockstep with App.jsx via localStorage.
  useEffect(() => {
    try { localStorage.setItem('language', language); } catch {}
  }, [language]);

  const t = (key) => getTranslation(language, key);

  const emailRef = useRef(null);
  useEffect(() => { emailRef.current?.focus(); }, []);

  const switchMode = () => {
    setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
    setError('');
    setInfoMessage('');
    setUsername('');
  };

  // Lightweight client-side validation. Server-side errors still surface
  // verbatim from supabase.auth.* — these only catch obvious typos.
  const validate = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(t('errorEmailInvalid'));
      return false;
    }
    if (password.length < 6) {
      setError(t('errorPasswordShort'));
      return false;
    }
    if (mode === 'signup' && username && !/^[A-Za-z0-9_]{3,32}$/.test(username)) {
      setError(t('fieldUsernameHint'));
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfoMessage('');

    if (!validate()) return;
    setLoading(true);

    try {
      if (mode === 'signup') {
        const fallback = email.split('@')[0].replace(/[^A-Za-z0-9_]/g, '').slice(0, 32) || 'user';
        const cleanUsername = (username || fallback).trim().slice(0, 32);

        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { username: cleanUsername } },
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
      setError(err?.message || t('errorGeneric'));
    } finally {
      setLoading(false);
    }
  };

  const isSignup = mode === 'signup';

  return (
    <div className="login-page" data-mode={mode}>
      {/* === LEFT MASTHEAD ============================================ */}
      <aside className="login-masthead" aria-hidden="false">
        <div className="masthead-corner masthead-corner--tl" />
        <div className="masthead-corner masthead-corner--br" />

        <header className="masthead-head">
          <div className="masthead-eyebrow">
            <span>{t('mastheadNumber')}</span>
            <span className="masthead-eyebrow-dot" />
            <span>{t('mastheadSection')}</span>
            <span className="masthead-eyebrow-dot" />
            <span>{t('mastheadDate')}</span>
          </div>

          <div className="masthead-rule" />

          <h1 className="masthead-title">
            <span className="masthead-title-line">Paqute</span>
            <span className="masthead-title-line masthead-title-line--alt">Messenger</span>
          </h1>

          <p className="masthead-dek">{t('mastheadDek')}</p>

          <div className="masthead-bar">
            <span className="masthead-bar-bar" />
            <span className="masthead-bar-text">
              {isSignup ? t('createAccount') : t('signIn')}
            </span>
            <span className="masthead-bar-bar" />
          </div>
        </header>

        <ul className="masthead-list">
          <li>
            <span className="masthead-list-num">i.</span>
            <span className="masthead-list-text">
              {language === 'ru'
                ? 'Сообщения шифруются при передаче и доступны только участникам чата.'
                : language === 'uk'
                ? 'Повідомлення шифруються під час передавання та доступні лише учасникам чату.'
                : 'Messages are encrypted in transit and only readable by the chat members.'}
            </span>
          </li>
          <li>
            <span className="masthead-list-num">ii.</span>
            <span className="masthead-list-text">
              {language === 'ru'
                ? 'Ваш профиль, медиа и сохранённые заметки остаются приватными.'
                : language === 'uk'
                ? 'Ваш профіль, медіа та збережені нотатки залишаються приватними.'
                : 'Your profile, media and saved notes stay private to you.'}
            </span>
          </li>
          <li>
            <span className="masthead-list-num">iii.</span>
            <span className="masthead-list-text">
              {language === 'ru'
                ? 'Никакой рекламы. Никаких теневых трекеров.'
                : language === 'uk'
                ? 'Жодної реклами. Жодних прихованих трекерів.'
                : 'No advertising. No shadow trackers.'}
            </span>
          </li>
        </ul>

        <footer className="masthead-foot">
          <p className="masthead-colophon">{t('mastheadColophon')}</p>
          <div className="masthead-languages" role="group" aria-label="Language">
            <Languages size={14} aria-hidden />
            {LANGUAGES.map((l) => (
              <button
                key={l.id}
                type="button"
                className={'masthead-lang' + (language === l.id ? ' is-active' : '')}
                onClick={() => setLanguage(l.id)}
                aria-pressed={language === l.id}
              >
                {l.short}
              </button>
            ))}
          </div>
        </footer>
      </aside>

      {/* === RIGHT FORM =============================================== */}
      <main className="login-stage">
        <div className="login-card" role="region" aria-labelledby="login-card-title">
          <div className="login-card-head">
            <p className="login-card-kicker">
              <span className="login-card-kicker-mark">●</span>
              {isSignup ? t('signUp') : t('signIn')}
            </p>
            <h2 id="login-card-title" className="login-card-title">
              {isSignup ? t('createAccount') : t('welcomeBack')}
            </h2>
            <p className="login-card-dek">
              {isSignup ? t('createAccountHint') : t('welcomeBackHint')}
            </p>
          </div>

          <form className="login-form" onSubmit={handleSubmit} noValidate>
            {isSignup && (
              <div className="login-field">
                <label className="login-field-label" htmlFor="login-username">
                  <UserIcon size={12} aria-hidden />
                  <span>{t('fieldUsername')}</span>
                </label>
                <div className="login-field-row">
                  <input
                    id="login-username"
                    className="login-input"
                    type="text"
                    placeholder={t('fieldUsername')}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    inputMode="text"
                    maxLength={32}
                  />
                  <span className="login-field-rule" aria-hidden />
                </div>
                <span className="login-field-hint">{t('fieldUsernameHint')}</span>
              </div>
            )}

            <div className="login-field">
              <label className="login-field-label" htmlFor="login-email">
                <Mail size={12} aria-hidden />
                <span>{t('fieldEmail')}</span>
              </label>
              <div className="login-field-row">
                <input
                  id="login-email"
                  ref={emailRef}
                  className="login-input"
                  type="email"
                  placeholder={t('fieldEmail')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  inputMode="email"
                />
                <span className="login-field-rule" aria-hidden />
              </div>
            </div>

            <div className="login-field">
              <label className="login-field-label" htmlFor="login-password">
                <KeyRound size={12} aria-hidden />
                <span>{t('fieldPassword')}</span>
              </label>
              <div className="login-field-row">
                <input
                  id="login-password"
                  className="login-input"
                  type={showPassword ? 'text' : 'password'}
                  placeholder={t('fieldPassword')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                />
                <button
                  type="button"
                  className="login-reveal"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                </button>
                <span className="login-field-rule" aria-hidden />
              </div>
            </div>

            <div className="login-meta">
              <label className="login-remember">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                <span>{t('rememberMe')}</span>
              </label>
              {!isSignup && (
                <button
                  type="button"
                  className="login-forgot"
                  onClick={async () => {
                    if (!email) {
                      setError(t('errorEmailInvalid'));
                      return;
                    }
                    setError('');
                    setInfoMessage('');
                    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
                      redirectTo: window.location.origin,
                    });
                    if (err) setError(err.message);
                    else setInfoMessage(
                      language === 'ru'
                        ? 'Письмо для сброса отправлено — проверь почту.'
                        : language === 'uk'
                        ? 'Лист для скидання надіслано — перевір пошту.'
                        : 'Reset email sent — check your inbox.'
                    );
                  }}
                >
                  {t('forgotPassword')}
                </button>
              )}
            </div>

            {error && (
              <p className="login-error" role="alert">
                <span className="login-error-mark">!</span>
                <span>{error}</span>
              </p>
            )}
            {infoMessage && (
              <p className="login-info" role="status">
                <span className="login-info-mark">✓</span>
                <span>{infoMessage}</span>
              </p>
            )}

            <button className="login-button" type="submit" disabled={loading}>
              <span className="login-button-text">
                {loading ? t('ctaWorking') : (isSignup ? t('ctaSignUp') : t('ctaSignIn'))}
              </span>
              {!loading && <ArrowRight size={16} aria-hidden />}
              <span className="login-button-rule" aria-hidden />
            </button>

            <p className="login-terms">{t('termsNotice')}</p>
          </form>

          <button
            type="button"
            className="login-switch-btn"
            onClick={switchMode}
          >
            {isSignup ? t('haveAccount') : t('noAccount')}
            <span className="login-switch-btn-rule" aria-hidden />
          </button>
        </div>
      </main>
    </div>
  );
}

export default Login;
