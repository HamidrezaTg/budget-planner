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

export default function App() {
  const [status, setStatus] = useState(null);
  const [me, setMe] = useState(null);

  useEffect(() => {
    api.get('/auth/status').then(setStatus).catch(() => setStatus({ passwordSet: false }));
  }, []);

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
            <Route path="/balances" element={<Balances />} />
            <Route path="/projection" element={<Projection />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/help" element={<Help />} />
            {me?.admin && <Route path="/users" element={<Users admin me={me.username} />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </DialogProvider>
  );
}
