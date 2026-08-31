import { useState } from 'react';
import { api } from '../api.js';

export default function Login({ setup = false }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post(setup ? '/auth/setup' : '/auth/login', { username, password });
      window.location.href = '/';
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form onSubmit={submit} className="card login-card">
        <h1>Budget Planner</h1>
        <p className="muted">
          {setup
            ? 'Welcome! Create the first account. Each account gets its own private database.'
            : 'Log in to your account.'}
        </p>
        <input
          type="text"
          placeholder="Username"
          value={username}
          autoComplete="username"
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          autoComplete={setup ? 'new-password' : 'current-password'}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="error">{error}</div>}
        <button className="btn primary" type="submit" disabled={busy}>
          {setup ? 'Create account & start' : 'Log in'}
        </button>
      </form>
    </div>
  );
}
