import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import { api } from './api.js';
import Layout from './components/Layout.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { DialogProvider } from './components/Dialog.jsx';
import Login from './pages/Login.jsx';
import Help from './pages/Help.jsx';

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Budgets = lazy(() => import('./pages/Budgets.jsx'));
const ImportPage = lazy(() => import('./pages/ImportPage.jsx'));
const Transactions = lazy(() => import('./pages/Transactions.jsx'));
const Funds = lazy(() => import('./pages/Funds.jsx'));
const Commitments = lazy(() => import('./pages/Commitments.jsx'));
const Income = lazy(() => import('./pages/Income.jsx'));
const Balances = lazy(() => import('./pages/Balances.jsx'));
const Projection = lazy(() => import('./pages/Projection.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Categories = lazy(() => import('./pages/Categories.jsx'));
const Chat = lazy(() => import('./pages/Chat.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Users = lazy(() => import('./pages/Users.jsx'));
const Recurring = lazy(() => import('./pages/Recurring.jsx'));
const Accounts = lazy(() => import('./pages/Accounts.jsx'));
const Shared = lazy(() => import('./pages/Shared.jsx'));

export default function App() {
  const [status, setStatus] = useState(null);
  const [me, setMe] = useState(null);
  const [offline, setOffline] = useState(false);
  const [retry, setRetry] = useState(0);
  const { pathname } = useLocation();
  const publicHelp = pathname === '/help' || pathname === '/help/';

  useEffect(() => {
    setOffline(false);
    api
      .get('/auth/status')
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
      api
        .get('/auth/me')
        .then((info) => {
          setMe(info);
          localStorage.setItem('bp-currency', info.currency || 'EUR');
        })
        .catch(() => {});
    }
  }, [status?.passwordSet]);

  // Help is deliberately available before login and while the server is down.
  // It is a static guide, so it can explain recovery without depending on API state.
  if (publicHelp) return <Help public />;

  if (offline) {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <h1>Budget Planner</h1>
          <p className="muted">
            The planner server is not reachable. The page you see was served from the offline cache
            — your data is untouched.
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
        <Suspense fallback={<div className="loading">Loading…</div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/share/:token" element={<Shared />} />
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
              {me?.admin && <Route path="/users" element={<Users admin me={me.username} />} />}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </DialogProvider>
  );
}
