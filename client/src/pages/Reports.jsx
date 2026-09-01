import { useEffect, useState } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
} from 'recharts';
import { api, eur } from '../api.js';
import { useWorkingMonth } from '../components/WorkingMonth.jsx';

const fmtEur = (v) => eur(v);
const monthNames = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const PALETTE = [
  '#6366f1',
  '#22d3ee',
  '#fbbf24',
  '#f472b6',
  '#a78bfa',
  '#2dd4bf',
  '#f87171',
  '#818cf8',
  '#34d399',
  '#94a3b8',
];

function previousMonth(month) {
  const [year, value] = month.split('-').map(Number);
  const date = new Date(year, value - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export default function Reports() {
  const { month } = useWorkingMonth();
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const [monthly, setMonthly] = useState(null);
  const [previousMonthly, setPreviousMonthly] = useState(null);
  const [yearly, setYearly] = useState(null);
  const [history, setHistory] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [trendCategory, setTrendCategory] = useState('');
  const [error, setError] = useState('');

  useEffect(() => setYear(Number(month.slice(0, 4))), [month]);
  useEffect(() => {
    api
      .get('/accounts')
      .then(setAccounts)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const query = accountId ? `?account_id=${accountId}` : '';
    api
      .get(`/reports/monthly/${month}${query}`)
      .then(setMonthly)
      .catch((e) => setError(e.message));
    api
      .get(`/reports/monthly/${previousMonth(month)}${query}`)
      .then(setPreviousMonthly)
      .catch(() => setPreviousMonthly(null));
  }, [month, accountId]);
  useEffect(() => {
    const query = accountId ? `?account_id=${accountId}` : '';
    api
      .get(`/reports/yearly/${year}${query}`)
      .then(setYearly)
      .catch((e) => setError(e.message));
  }, [year, accountId]);
  useEffect(() => {
    api
      .post('/reports/history/capture')
      .then((h) => setHistory(h.rows))
      .catch(() => {});
  }, []);

  const histAsc = history ? [...history].reverse() : [];
  const previousByCategory = new Map(
    (previousMonthly?.byCategory || []).map((row) => [row.name, row]),
  );
  const trendCategories = [...new Set((yearly?.byCategoryMonthly || []).map((row) => row.name))];
  const selectedTrendCategory = trendCategories.includes(trendCategory)
    ? trendCategory
    : trendCategories[0] || '';
  const trendData = Array.from({ length: 12 }, (_, index) => {
    const key = `${year}-${String(index + 1).padStart(2, '0')}`;
    const row = yearly?.byCategoryMonthly?.find(
      (item) => item.month === key && item.name === selectedTrendCategory,
    );
    return { name: monthNames[index], spent: row ? Math.abs(row.spent) : 0 };
  });
  const printReport = () => window.print();
  const exportQuery = accountId ? `?account_id=${accountId}` : '';

  return (
    <div>
      <h1>Reports</h1>
      {error && <div className="error">{error}</div>}

      <div className="filters card">
        <label>
          Month
          <span>{month}</span>
        </label>
        <label>
          Account
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">All accounts</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <a className="btn ghost" href={`/api/reports/export/monthly/${month}${exportQuery}`}>
          ⬇ Export monthly CSV
        </a>
        <a className="btn ghost" href={`/api/reports/export/monthly/${month}.xlsx${exportQuery}`}>
          ⬇ Excel
        </a>
        <label style={{ marginLeft: 16 }}>
          Year
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{ width: 90 }}
          />
        </label>
        <a className="btn ghost" href={`/api/reports/export/yearly/${year}${exportQuery}`}>
          ⬇ Export yearly CSV
        </a>
        <a className="btn ghost" href={`/api/reports/export/yearly/${year}.xlsx${exportQuery}`}>
          ⬇ Excel
        </a>
        <button className="btn ghost print-report" onClick={printReport}>
          Print / PDF
        </button>
      </div>

      {monthly && (
        <>
          <h2>{monthly.month} summary</h2>
          <div className="stats-row">
            <div className="card stat">
              <div className="stat-label">Income</div>
              <div className="stat-value income">{eur(monthly.totals.income)}</div>
            </div>
            <div className="card stat">
              <div className="stat-label">Expenses</div>
              <div className="stat-value expense">{eur(Math.abs(monthly.totals.expenses))}</div>
            </div>
            <div className="card stat">
              <div className="stat-label">Transactions</div>
              <div className="stat-value">{monthly.totals.n}</div>
            </div>
          </div>
          <div className="card table-card">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Spent</th>
                  <th>Budget</th>
                  <th>Variance</th>
                  <th>MoM</th>
                </tr>
              </thead>
              <tbody>
                {monthly.byCategory.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td className={r.spent < 0 ? 'expense' : 'income'}>{eur(r.spent)}</td>
                    <td>{r.budget ? eur(r.budget) : '—'}</td>
                    <td>
                      {r.variance !== null && r.variance !== undefined && (
                        <span className={r.variance >= 0 ? 'good' : 'bad'}>
                          {r.variance >= 0
                            ? `${eur(r.variance)} under`
                            : `${eur(-r.variance)} over`}
                        </span>
                      )}
                    </td>
                    <td>
                      {previousByCategory.has(r.name)
                        ? (() => {
                            const delta =
                              Math.abs(r.spent) - Math.abs(previousByCategory.get(r.name).spent);
                            return (
                              <span className={delta <= 0 ? 'good' : 'bad'}>
                                {delta > 0 ? '+' : ''}
                                {eur(delta)}
                              </span>
                            );
                          })()
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {yearly && (
        <>
          <h2>{yearly.year} overview</h2>
          <div className="stats-row">
            <div className="card stat">
              <div className="stat-label">Income</div>
              <div className="stat-value income">{eur(yearly.totals.income)}</div>
            </div>
            <div className="card stat">
              <div className="stat-label">Expenses</div>
              <div className="stat-value expense">{eur(Math.abs(yearly.totals.expenses))}</div>
            </div>
            <div className="card stat">
              <div className="stat-label">vs {yearly.year - 1}</div>
              <div
                className={`stat-value ${Math.abs(yearly.totals.expenses) <= Math.abs(yearly.prevYearExpenses) ? 'income' : 'expense'}`}
              >
                {yearly.prevYearExpenses === 0
                  ? '—'
                  : `${Math.abs(yearly.totals.expenses) <= Math.abs(yearly.prevYearExpenses) ? '▼' : '▲'} ${eur(Math.abs(Math.abs(yearly.totals.expenses) - Math.abs(yearly.prevYearExpenses)))}`}
              </div>
            </div>
          </div>

          <h2>Income vs expenses by month</h2>
          <div className="card chart-card">
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart
                data={yearly.months.map((m) => ({
                  name: monthNames[Number(m.month.slice(5)) - 1],
                  income: m.income,
                  expenses: Math.abs(m.expenses),
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3040" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12 }}
                  interval={Math.max(Math.ceil(yearly.months.length / 6) - 1, 0)}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={fmtEur} />
                <Legend />
                <Bar dataKey="expenses" fill="#f87171" radius={[4, 4, 0, 0]} />
                <Bar dataKey="income" fill="#34d399" radius={[4, 4, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <h2>Yearly spending by category</h2>
          <div className="charts-split">
            <div className="card chart-card">
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={yearly.byCategory.map((c, i) => ({
                      name: c.name,
                      value: Math.abs(c.spent),
                      color: PALETTE[i % PALETTE.length],
                    }))}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                    outerRadius={110}
                    paddingAngle={2}
                  >
                    {yearly.byCategory.map((c, i) => (
                      <Cell key={c.name} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={fmtEur} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="card table-card">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Spent</th>
                  </tr>
                </thead>
                <tbody>
                  {yearly.byCategory.map((c, i) => (
                    <tr key={c.name}>
                      <td>
                        <span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />{' '}
                        {c.name}
                      </td>
                      <td className="expense">{eur(c.spent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {trendCategories.length > 0 && (
            <>
              <div className="section-kicker report-trend-head">
                <h2>Category trend</h2>
                <label className="muted tiny">
                  Category{' '}
                  <select
                    value={selectedTrendCategory}
                    onChange={(e) => setTrendCategory(e.target.value)}
                  >
                    {trendCategories.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="card chart-card">
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a3040" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={fmtEur} />
                    <Bar dataKey="spent" name="Spent" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </>
      )}

      {histAsc.length > 0 && (
        <>
          <h2>Month-end history</h2>
          <p className="muted">
            Frozen snapshots captured automatically when a month closed. Later edits never rewrite
            them — the budget accuracy you see is what it was.
          </p>
          <div className="card chart-card">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart
                data={histAsc.map((r) => ({
                  name: monthNames[Number(r.month.slice(5)) - 1],
                  year: r.month.slice(0, 4),
                  income: r.income,
                  expenses: Math.abs(r.expenses),
                  result: r.result,
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3040" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12 }}
                  interval={Math.max(Math.ceil(histAsc.length / 6) - 1, 0)}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={fmtEur}
                  labelFormatter={(label) => {
                    const row = histAsc.find(
                      (r) => monthNames[Number(r.month.slice(5)) - 1] === label,
                    );
                    return row ? row.month : label;
                  }}
                />
                <Legend />
                <Bar dataKey="expenses" fill="#f87171" radius={[4, 4, 0, 0]} />
                <Bar dataKey="income" fill="#34d399" radius={[4, 4, 0, 0]} />
                <Line dataKey="result" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="card table-card">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Income</th>
                  <th>Spent</th>
                  <th>Planned</th>
                  <th>Result</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.month}>
                    <td>{r.month}</td>
                    <td className="income">{eur(r.income)}</td>
                    <td className="expense">{eur(Math.abs(r.expenses))}</td>
                    <td>{eur(r.planned)}</td>
                    <td className={r.result >= 0 ? 'good' : 'bad'}>
                      {r.result >= 0 ? `+${eur(r.result)} under` : `${eur(-r.result)} over`}
                    </td>
                    <td className="muted">{r.transaction_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
