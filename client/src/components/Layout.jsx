import React, { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../api.js';

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
      { to: '/budgets', label: 'Budgets', glyph: '▤' },
      { to: '/income', label: 'Income', glyph: '↑' },
    ],
  },
  {
    label: 'Planning',
    links: [
      { to: '/funds', label: 'Funds', glyph: '◎' },
      { to: '/commitments', label: 'Commitments', glyph: '¶' },
      { to: '/balances', label: 'Balances', glyph: '◍' },
      { to: '/categories', label: 'Categories', glyph: '⊞' },
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
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('bp-collapsed') === '1'
  );
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || 'light'
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('bp-theme', theme);
  }, [theme]);

  const toggleCollapse = () => {
    setCollapsed((c) => {
      localStorage.setItem('bp-collapsed', c ? '0' : '1');
      return !c;
    });
  };

  const logout = async () => {
    await api.post('/auth/logout');
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
      <aside className="sidebar">
        <button className="brand" onClick={toggleCollapse} title={collapsed ? 'Expand menu' : 'Collapse menu'}>
          <span className="brand-mark"><i></i><i></i><i></i></span>
          <span className="brand-name">Budget Planner</span>
        </button>

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
            <button
              className="icon-btn"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
            <button className="icon-btn" title="Log out" onClick={logout}>⇥</button>
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
