import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from './api.js';
import Layout from './components/Layout.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { DialogProvider } from './components/Dialog.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Budgets from './pages/Budgets.jsx';
import ImportPage from './pages/ImportPage.jsx';
import Transactions from './pages/Transactions.jsx';
import Funds from './pages/Funds.jsx';
import Commitments from './pages/Commitments.jsx';
import Income from './pages/Income.jsx';
import Balances from './pages/Balances.jsx';
import Projection from './pages/Projection.jsx';
import Reports from './pages/Reports.jsx';
import Categories from './pages/Categories.jsx';
import Chat from './pages/Chat.jsx';
import Settings from './pages/Settings.jsx';
import Help from './pages/Help.jsx';
import Users from './pages/Users.jsx';
import Recurring from './pages/Recurring.jsx';
import Accounts from './pages/Accounts.jsx';

export default function App() {
  const [status, setStatus] = useState(null);
  const [me, setMe] = useState(null);
  const [offline, setOffline] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setOffline(false);
    api.get('/auth/status')
      .then(setStatus)
      .catch(() => {
        // Server unreachable (stopped, restarting, or offline). Never show the
        // first-run setup screen in this case — it would look like all
        // accounts vanished.
        setStatus(null);
        setOffline(true);
      });
  }, [retry]);

  useEffect(() => {
    if (status?.passwordSet) {
      api.get('/auth/me')
        .then((info) => {
          setMe(info);
          localStorage.setItem('bp-currency', info.currency || 'EUR');
        })
        .catch(() => {});
    }
  }, [status?.passwordSet]);

  if (offline) {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <h1>Budget Planner</h1>
          <p className="muted">
            The planner server is not reachable. The page you see was served from the
            offline cache — your data is untouched.
          </p>
          <p className="muted tiny">
            Start it from the project folder with <code>npm start</code>, then retry.
          </p>
          <button className="btn primary" onClick={() => setRetry((r) => r + 1)}>
            Retry connection
          </button>
        </div>
      </div>
    );
  }

  if (!status) return <div className="loading">Loading…</div>;

  if (!status.passwordSet) {
    return (
      <DialogProvider>
        <Routes>
          <Route path="*" element={<Login setup />} />
        </Routes>
      </DialogProvider>
    );
  }

  return (
    <DialogProvider>
      <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout me={me} />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/budgets" element={<Budgets />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/recurring" element={<Recurring />} />
            <Route path="/funds" element={<Funds />} />
            <Route path="/commitments" element={<Commitments />} />
            <Route path="/income" element={<Income />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/balances" element={<Balances />} />
            <Route path="/projection" element={<Projection />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/settings" element={<Settings me={me} />} />
            <Route path="/help" element={<Help />} />
            {me?.admin && <Route path="/users" element={<Users admin me={me.username} />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </DialogProvider>
  );
}
