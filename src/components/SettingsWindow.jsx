import { useState, useEffect, useRef } from 'react';
import { X, Moon, Sun, Type, Image, Palette, Download, Upload, Check, Globe } from 'lucide-react';
import './SettingsWindow.css';

const LANGUAGES = [
  { id: 'en', label: 'English', native: 'English' },
  { id: 'uk', label: 'Ukrainian', native: 'Українська' },
  { id: 'ru', label: 'Russian', native: 'Русский' },
];

const THEMES = [
  { id: 'blue', name: 'Ocean Blue', primary: '#2563EB', secondary: '#3B82F6' },
  { id: 'green', name: 'Forest Green', primary: '#059669', secondary: '#10B981' },
  { id: 'purple', name: 'Royal Purple', primary: '#7C3AED', secondary: '#8B5CF6' },
  { id: 'pink', name: 'Rose Pink', primary: '#DB2777', secondary: '#EC4899' },
  { id: 'orange', name: 'Sunset Orange', primary: '#EA580C', secondary: '#F97316' },
  { id: 'teal', name: 'Tropical Teal', primary: '#0D9488', secondary: '#14B8A6' },
];

const FONTS = [
  { id: 'inter', name: 'Inter', family: 'Inter, sans-serif' },
  { id: 'roboto', name: 'Roboto', family: 'Roboto, sans-serif' },
  { id: 'poppins', name: 'Poppins', family: 'Poppins, sans-serif' },
  { id: 'montserrat', name: 'Montserrat', family: 'Montserrat, sans-serif' },
  { id: 'lato', name: 'Lato', family: 'Lato, sans-serif' },
  { id: 'opensans', name: 'Open Sans', family: '"Open Sans", sans-serif' },
];

const WALLPAPERS = [
  { id: 'none', name: 'None', url: null },
  { id: 'gradient1', name: 'Blue Gradient', url: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
  { id: 'gradient2', name: 'Sunset', url: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
  { id: 'gradient3', name: 'Ocean', url: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' },
  { id: 'gradient4', name: 'Forest', url: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' },
  { id: 'gradient5', name: 'Twilight', url: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)' },
  { id: 'pattern1', name: 'Dots', url: 'radial-gradient(circle, rgba(255,255,255,0.1) 1px, transparent 1px)', size: '20px 20px' },
];

function SettingsWindow({ isOpen, onClose, settings, onSettingsChange, language, onLanguageChange, t }) {
  const [activeTab, setActiveTab] = useState('appearance');
  const [animateOut, setAnimateOut] = useState(false);
  const closeTimeoutRef = useRef(null);
  const tr = t || ((k) => k);

  useEffect(() => {
    if (isOpen) {
      setAnimateOut(false);
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  const handleClose = () => {
    setAnimateOut(true);
    closeTimeoutRef.current = setTimeout(() => {
      closeTimeoutRef.current = null;
      setAnimateOut(false);
      onClose();
    }, 300);
  };

  const handleThemeChange = (themeId) => {
    const theme = THEMES.find(t => t.id === themeId);
    if (theme) {
      onSettingsChange({
        ...settings,
        chatTheme: themeId,
        customColors: {
          primary: theme.primary,
          secondary: theme.secondary,
        }
      });
    }
  };

  const handleFontChange = (fontId) => {
    const font = FONTS.find(f => f.id === fontId);
    if (font) {
      onSettingsChange({
        ...settings,
        font: fontId,
        fontFamily: font.family,
      });
    }
  };

  const handleWallpaperChange = (wallpaperId) => {
    const wallpaper = WALLPAPERS.find(w => w.id === wallpaperId);
    if (wallpaper) {
      onSettingsChange({
        ...settings,
        wallpaper: wallpaperId,
        wallpaperUrl: wallpaper.url,
        wallpaperSize: wallpaper.size,
      });
    }
  };

  const handleModeChange = (mode) => {
    onSettingsChange({
      ...settings,
      mode: mode,
    });
  };

  const handleExport = () => {
    const dataStr = JSON.stringify(settings, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const exportFileDefaultName = 'messenger-settings.json';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const handleImport = (event) => {
    const file = event.target.files[0];
    event.target.value = ''; // allow re-importing same file
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const importedSettings = JSON.parse(e.target.result);
          onSettingsChange(importedSettings);
        } catch (error) {
          alert('Invalid settings file');
        }
      };
      reader.readAsText(file);
    }
  };

  if (!isOpen && !animateOut) return null;

  return (
    <div className={`settings-overlay ${animateOut ? 'closing' : ''}`} onClick={handleClose}>
      <div className={`settings-window ${animateOut ? 'closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="settings-header">
          <h2 className="settings-title">{tr('settings')}</h2>
          <button className="settings-close-btn" onClick={handleClose} aria-label="Close settings">
            <X size={24} />
          </button>
        </div>

        {/* Tabs */}
        <div className="settings-tabs">
          <button
            className={`settings-tab ${activeTab === 'appearance' ? 'active' : ''}`}
            onClick={() => setActiveTab('appearance')}
          >
            <Palette size={18} />
            <span>{tr('appearance')}</span>
          </button>
          <button
            className={`settings-tab ${activeTab === 'typography' ? 'active' : ''}`}
            onClick={() => setActiveTab('typography')}
          >
            <Type size={18} />
            <span>{tr('typography')}</span>
          </button>
          <button
            className={`settings-tab ${activeTab === 'wallpaper' ? 'active' : ''}`}
            onClick={() => setActiveTab('wallpaper')}
          >
            <Image size={18} />
            <span>{tr('wallpaper')}</span>
          </button>
          <button
            className={`settings-tab ${activeTab === 'language' ? 'active' : ''}`}
            onClick={() => setActiveTab('language')}
          >
            <Globe size={18} />
            <span>{tr('language')}</span>
          </button>
        </div>

        {/* Content */}
        <div className="settings-content">
          {activeTab === 'appearance' && (
            <div className="settings-section">
              <div className="section-header">
                <h3 className="section-title">{tr('themeMode')}</h3>
                <p className="section-description">{tr('chooseMode')}</p>
              </div>

              <div className="mode-selector">
                <button
                  className={`mode-card ${settings.mode === 'dark' ? 'active' : ''}`}
                  onClick={() => handleModeChange('dark')}
                >
                  <div className="mode-icon">
                    <Moon size={32} />
                  </div>
                  <span className="mode-name">{tr('darkMode')}</span>
                  {settings.mode === 'dark' && (
                    <div className="mode-check">
                      <Check size={16} />
                    </div>
                  )}
                </button>
                <button
                  className={`mode-card ${settings.mode === 'light' ? 'active' : ''}`}
                  onClick={() => handleModeChange('light')}
                >
                  <div className="mode-icon">
                    <Sun size={32} />
                  </div>
                  <span className="mode-name">{tr('lightMode')}</span>
                  {settings.mode === 'light' && (
                    <div className="mode-check">
                      <Check size={16} />
                    </div>
                  )}
                </button>
              </div>

              <div className="section-divider" />

              <div className="section-header">
                <h3 className="section-title">{tr('chatTheme')}</h3>
                <p className="section-description">{tr('customizeBubbles')}</p>
              </div>

              <div className="theme-grid">
                {THEMES.map(theme => (
                  <button
                    key={theme.id}
                    className={`theme-card ${settings.chatTheme === theme.id ? 'active' : ''}`}
                    onClick={() => handleThemeChange(theme.id)}
                  >
                    <div className="theme-preview">
                      <div className="theme-bubble" style={{ background: theme.primary }} />
                      <div className="theme-bubble small" style={{ background: theme.secondary }} />
                    </div>
                    <span className="theme-name">{theme.name}</span>
                    {settings.chatTheme === theme.id && (
                      <div className="theme-check">
                        <Check size={14} />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'typography' && (
            <div className="settings-section">
              <div className="section-header">
                <h3 className="section-title">{tr('fontFamily')}</h3>
                <p className="section-description">{tr('chooseFont')}</p>
              </div>

              <div className="font-list">
                {FONTS.map(font => (
                  <button
                    key={font.id}
                    className={`font-card ${settings.font === font.id ? 'active' : ''}`}
                    onClick={() => handleFontChange(font.id)}
                    style={{ fontFamily: font.family }}
                  >
                    <div className="font-info">
                      <span className="font-name">{font.name}</span>
                      <span className="font-sample">The quick brown fox jumps</span>
                    </div>
                    {settings.font === font.id && (
                      <div className="font-check">
                        <Check size={18} />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'wallpaper' && (
            <div className="settings-section">
              <div className="section-header">
                <h3 className="section-title">{tr('chatWallpaper')}</h3>
                <p className="section-description">{tr('setBackground')}</p>
              </div>

              <div className="wallpaper-grid">
                {WALLPAPERS.map(wallpaper => (
                  <button
                    key={wallpaper.id}
                    className={`wallpaper-card ${settings.wallpaper === wallpaper.id ? 'active' : ''}`}
                    onClick={() => handleWallpaperChange(wallpaper.id)}
                  >
                    <div
                      className="wallpaper-preview"
                      style={{
                        background: wallpaper.url || 'var(--color-background)',
                        backgroundSize: wallpaper.size || 'cover',
                      }}
                    >
                      {wallpaper.id === 'none' && (
                        <span className="wallpaper-none-text">None</span>
                      )}
                    </div>
                    <span className="wallpaper-name">{wallpaper.name}</span>
                    {settings.wallpaper === wallpaper.id && (
                      <div className="wallpaper-check">
                        <Check size={14} />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'language' && (
            <div className="settings-section">
              <div className="section-header">
                <h3 className="section-title">{tr('interfaceLanguage')}</h3>
                <p className="section-description">{tr('chooseLanguage')}</p>
              </div>

              <div className="lang-list">
                {LANGUAGES.map(lang => (
                  <button
                    key={lang.id}
                    className={`lang-card ${language === lang.id ? 'active' : ''}`}
                    onClick={() => onLanguageChange && onLanguageChange(lang.id)}
                  >
                    <div className="lang-info">
                      <span className="lang-native">{lang.native}</span>
                      <span className="lang-english">{lang.label}</span>
                    </div>
                    {language === lang.id && (
                      <div className="lang-card-check">
                        <Check size={18} />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="settings-footer">
          <button className="export-btn" onClick={handleExport}>
            <Download size={18} />
            <span>{tr('exportSettings')}</span>
          </button>
          <label className="import-btn">
            <input
              type="file"
              accept=".json"
              onChange={handleImport}
              style={{ display: 'none' }}
            />
            <Upload size={18} />
            <span>{tr('importSettings')}</span>
          </label>
        </div>
      </div>
    </div>
  );
}

export default SettingsWindow;
