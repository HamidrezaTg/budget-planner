import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api.js';

const THEMES = new Set(['system', 'light', 'dark', 'midnight', 'forest']);
const ThemeContext = createContext(null);

function validTheme(value) {
  return THEMES.has(value) ? value : 'system';
}

export function ThemeProvider({ children, username }) {
  const [theme, setThemeState] = useState(() => validTheme(localStorage.getItem('bp-theme')));

  useEffect(() => {
    const key = username ? `bp-theme:${username}` : 'bp-theme';
    const localTheme = localStorage.getItem(key) || localStorage.getItem('bp-theme');
    if (localTheme) setThemeState(validTheme(localTheme));
    if (!username) return;

    api
      .get('/settings')
      .then((settings) => {
        if (!THEMES.has(settings.theme)) return;
        setThemeState(settings.theme);
        localStorage.setItem(key, settings.theme);
        localStorage.setItem('bp-theme', settings.theme);
      })
      .catch(() => {});
  }, [username]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = (nextTheme) => {
    const next = validTheme(nextTheme);
    const key = username ? `bp-theme:${username}` : 'bp-theme';
    setThemeState(next);
    localStorage.setItem(key, next);
    localStorage.setItem('bp-theme', next);
    if (username) api.put('/settings', { theme: next }).catch(() => {});
  };

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
