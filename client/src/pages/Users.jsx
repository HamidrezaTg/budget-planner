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
    <div>
      <h1>Users</h1>
      <p className="muted">
        Every user has their own private database, starting from a clean, generic
        setup — they name their own accounts and categories. The admin can add users,
        reset passwords and delete accounts.
      </p>

      <form onSubmit={add} className="card inline-form">
        <input
          placeholder="Username (letters, numbers, . _ -)"
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
        />
        <input
          type="password"
          placeholder="Password (min 4 chars)"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <button className="btn primary">Add user</button>
        {error && <span className="error">{error}</span>}
      </form>

      <div className="card table-card">
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
                  <button className="btn small" onClick={() => resetPassword(u)}>Reset password</button>
                  <button
                    className="btn danger small"
                    disabled={u.username === me}
                    onClick={() => remove(u)}
                  >
                    Delete
                  </button>
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
