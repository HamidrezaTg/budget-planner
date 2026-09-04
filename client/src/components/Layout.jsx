import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { WorkingMonthProvider, useWorkingMonth } from './WorkingMonth.jsx';
import { ThemeProvider, useTheme } from './Theme.jsx';

const groups = [
  {
    label: 'Overview',
    links: [
      { to: '/', label: 'Dashboard', glyph: '⌁', end: true },
      { to: '/projection', label: 'Projection', glyph: '◫' },
      { to: '/reports', label: 'Reports', glyph: '▦' },
    ],
  },
  {
    label: 'Money in & out',
    links: [
      { to: '/import', label: 'Import', glyph: '⇩' },
      { to: '/transactions', label: 'Transactions', glyph: '⇄' },
      { to: '/recurring', label: 'Scheduled', glyph: '↻' },
      { to: '/budgets', label: 'Budgets', glyph: '▤' },
      { to: '/income', label: 'Income', glyph: '↑' },
    ],
  },
  {
    label: 'Planning',
    links: [
      { to: '/accounts', label: 'Accounts', glyph: '◉' },
      { to: '/funds', label: 'Funds', glyph: '◎' },
      { to: '/commitments', label: 'Commitments', glyph: '¶' },
      { to: '/balances', label: 'Balances', glyph: '◍' },
      { to: '/categories', label: 'Categories', glyph: '⊞' },
      { to: '/rules', label: 'Rules', glyph: '≔' },
    ],
  },
  {
    label: 'Assistant',
    links: [
      { to: '/chat', label: 'AI Chat', glyph: '✳' },
      { to: '/settings', label: 'Settings', glyph: '⚙' },
      { to: '/help', label: 'Help', glyph: '?' },
    ],
  },
];

export default function Layout({ me }) {
  return (
    <ThemeProvider username={me?.username}>
      <WorkingMonthProvider>
        <LayoutContent me={me} />
      </WorkingMonthProvider>
    </ThemeProvider>
  );
}

function LayoutContent({ me }) {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('bp-collapsed') === '1');
  const [menuOpen, setMenuOpen] = useState(false);
  const [privacy, setPrivacy] = useState(() => localStorage.getItem('bp-privacy') === '1');
  const [nativeShell, setNativeShell] = useState(false);
  const { month, setMonth } = useWorkingMonth();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    document.body.classList.toggle('privacy-mode', privacy);
    localStorage.setItem('bp-privacy', privacy ? '1' : '0');
    return () => document.body.classList.remove('privacy-mode');
  }, [privacy]);

  useEffect(() => {
    let waitingForRoute = false;
    let timeout;
    const routes = { d: '/', t: '/transactions', r: '/reports' };
    const onKeyDown = (event) => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName));
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '?') {
        event.preventDefault();
        navigate('/help');
        waitingForRoute = false;
        return;
      }
      if (event.key.toLowerCase() === 'g') {
        waitingForRoute = true;
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          waitingForRoute = false;
        }, 1000);
        return;
      }
      if (waitingForRoute && routes[event.key.toLowerCase()]) {
        event.preventDefault();
        navigate(routes[event.key.toLowerCase()]);
      }
      waitingForRoute = false;
      clearTimeout(timeout);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [navigate]);

  useEffect(() => {
    setNativeShell(Boolean(window.Capacitor?.isNativePlatform?.()));
  }, []);

  const switchServer = () => {
    // The native shell owns the saved-server picker. Returning with the hash
    // tells it not to auto-connect to the current server again.
    window.location.href = 'http://localhost/#server-picker';
  };

  // Close the mobile drawer whenever a desktop-width viewport is (re)entered.
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 900) setMenuOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const toggleCollapse = () => {
    setCollapsed((c) => {
      localStorage.setItem('bp-collapsed', c ? '0' : '1');
      return !c;
    });
  };

  const logout = async () => {
    // The session cookie is server-side anyway — always land on /login, even
    // if the logout call itself fails (e.g. offline).
    try {
      await api.post('/auth/logout');
    } catch {}
    window.location.href = '/login';
  };

  const groups2 = me?.admin
    ? [...groups, { label: 'Admin', links: [{ to: '/users', label: 'Users', glyph: '⌂' }] }]
    : groups;

  const initials = (me?.username || '?')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join('');

  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}`}>
      <aside className={`sidebar${menuOpen ? ' nav-open' : ''}`}>
        <button
          className="menu-btn"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? '✕' : '☰'}
        </button>
        <button
          className="brand"
          onClick={() => {
            setMenuOpen(false);
            toggleCollapse();
          }}
          title={collapsed ? 'Expand menu' : 'Collapse menu'}
        >
          <span className="brand-mark">
            <i></i>
            <i></i>
            <i></i>
          </span>
          <span className="brand-name">Gulden</span>
        </button>

        <div className="working-month">
          <label htmlFor="working-month">Working month</label>
          <input
            id="working-month"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </div>

        <nav className="side-nav" aria-label="Main navigation">
          {groups2.map((g) => (
            <div key={g.label} className="nav-group">
              {!collapsed && <div className="nav-label">{g.label}</div>}
              {g.links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.end}
                  title={l.label}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
                >
                  <span className="glyph">{l.glyph}</span>
                  <span className="nav-text">{l.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sync-card">
            <span className="sync-dot"></span>
            <div className="sync-text">
              <strong>Local planner</strong>
              <small>Your data stays on this machine</small>
            </div>
          </div>

          <div className="side-actions">
            {nativeShell && (
              <button
                className="icon-btn"
                title="Switch server"
                aria-label="Switch server"
                onClick={switchServer}
              >
                ⌘
              </button>
            )}
            <button
              className="icon-btn"
              title={privacy ? 'Show financial values' : 'Hide financial values'}
              aria-label={privacy ? 'Show financial values' : 'Hide financial values'}
              aria-pressed={privacy}
              onClick={() => setPrivacy((value) => !value)}
            >
              {privacy ? '◉' : '◌'}
            </button>
            <button
              className="icon-btn"
              title={
                theme === 'dark' || theme === 'midnight'
                  ? 'Switch to light mode'
                  : 'Switch to dark mode'
              }
              aria-label={
                theme === 'dark' || theme === 'midnight'
                  ? 'Switch to light mode'
                  : 'Switch to dark mode'
              }
              onClick={() => setTheme(theme === 'dark' || theme === 'midnight' ? 'light' : 'dark')}
            >
              {theme === 'dark' || theme === 'midnight' ? '☀' : '☾'}
            </button>
            <button className="icon-btn" title="Log out" aria-label="Log out" onClick={logout}>
              ⇥
            </button>
          </div>

          <div className="profile">
            <span className="avatar">{initials}</span>
            <div className="profile-text">
              <strong>{me?.username || '…'}</strong>
              <small>{me?.admin ? 'Admin · Personal budget' : 'Personal budget'}</small>
            </div>
          </div>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
