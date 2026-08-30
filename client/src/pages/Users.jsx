import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useDialogs } from '../components/Dialog.jsx';

export default function Users({ admin, me }) {
  const { confirm, prompt, toast } = useDialogs();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');

  const load = () => api.get('/auth/users').then(setUsers).catch(() => setUsers(null));
  useEffect(() => {
    if (admin) load();
  }, [admin]);

  const add = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/auth/users', form);
      toast(`Account "${form.username}" created with its own database.`);
      setForm({ username: '', password: '' });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const resetPassword = async (u) => {
    const pw = await prompt({
      title: `Reset password for "${u.username}"`,
      label: 'New password (min 4 chars). They will be logged out everywhere.',
      password: true,
    });
    if (!pw) return;
    try {
      await api.post(`/auth/users/${u.username}/password`, { new_password: pw });
      toast(`Password for "${u.username}" reset.`);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const remove = async (u) => {
    const ok = await confirm({
      title: `Delete "${u.username}"?`,
      message:
        'Their account and their entire database (transactions, budgets, rules) will be permanently removed. This cannot be undone.',
      danger: true,
      confirmLabel: 'Delete user',
    });
    if (!ok) return;
    try {
      await api.del(`/auth/users/${u.username}`);
      toast(`"${u.username}" deleted.`);
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  if (!admin) {
    return (
      <div>
        <h1>Users</h1>
        <div className="card warn-box">Only the admin account can manage users.</div>
      </div>
    );
  }

  return (
    <div className="users-page">
      <h1>Users</h1>
      <p className="muted">
        Every user has their own private database, starting from a clean, generic
        setup — they name their own accounts and categories. The admin can add users,
        reset passwords and delete accounts.
      </p>

      <div className="card users-card">
        <div className="panel-head">
          <div>
            <p className="eyebrow">You</p>
            <h2 style={{ fontSize: 18, margin: 0 }}>Your account</h2>
          </div>
        </div>
        <div className="users-summary">
          <span className="avatar avatar-lg">{(me || '?').slice(0, 2).toUpperCase()}</span>
          <div>
            <strong>{me}</strong>
            <small className="muted">Admin · Personal budget</small>
          </div>
        </div>
      </div>

      <div className="card users-card">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Add</p>
            <h2 style={{ fontSize: 18, margin: 0 }}>Create a new user</h2>
          </div>
        </div>
        <form onSubmit={add} className="add-user-form">
          <label title="2-32 characters, letters/numbers/_ only">Username
            <input
              placeholder="Username (letters, numbers, . _ -)"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </label>
          <label title="At least 8 characters">Password
            <input
              type="password"
              placeholder="Password (min 4 chars)"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <div className="btn-row" style={{ alignItems: 'center' }}>
            <button className="btn primary" title="Create the user and their own private database" disabled={!form.username || !form.password}>
              Add user
            </button>
            {error && <span className="error">{error}</span>}
          </div>
        </form>
      </div>

      <div className="card table-card">
        <div className="panel-head">
          <div>
            <p className="eyebrow">All users</p>
            <h2 style={{ fontSize: 18, margin: 0 }}>{(users ?? []).length} user{(users ?? []).length === 1 ? '' : 's'}</h2>
          </div>
        </div>
        <table>
          <thead>
            <tr><th>User</th><th>Role</th><th>Created</th><th></th></tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => (
              <tr key={u.username}>
                <td>
                  <span className="avatar avatar-sm">{u.username.slice(0, 2).toUpperCase()}</span>{' '}
                  {u.username}
                  {u.username === me && <span className="pill-badge accent-badge">you</span>}
                </td>
                <td className="muted">{u.role}</td>
                <td className="muted">{u.created_at?.slice(0, 10)}</td>
                <td>
                  <div className="env-actions">
                    <button
                      className="btn small"
                      title={`Reset "${u.username}"'s password — they'll be signed out everywhere`}
                      onClick={() => resetPassword(u)}
                    >Reset password</button>
                    <button
                      className="btn danger small"
                      title={`Delete the "${u.username}" user and their entire database — cannot be undone`}
                      disabled={u.username === me}
                      onClick={() => remove(u)}
                    >Delete</button>
                  </div>
                </td>
              </tr>
            ))}
            {users !== null && users.length === 0 && (
              <tr><td colSpan="4" className="muted">No users found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
