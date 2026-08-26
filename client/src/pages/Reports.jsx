import React, { useEffect, useState } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid,
} from 'recharts';
import { api, eur } from '../api.js';

const fmtEur = (v) => eur(v);
const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const PALETTE = ['#6366f1','#22d3ee','#fbbf24','#f472b6','#a78bfa','#2dd4bf','#f87171','#818cf8','#34d399','#94a3b8'];

export default function Reports() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [monthly, setMonthly] = useState(null);
  const [yearly, setYearly] = useState(null);

  useEffect(() => {
    api.get(`/reports/monthly/${month}`).then(setMonthly);
  }, [month]);
  useEffect(() => {
    api.get(`/reports/yearly/${year}`).then(setYearly);
  }, [year]);

  return (
    <div>
      <h1>Reports</h1>

      <div className="filters card">
        <label>Month
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <a className="btn ghost" href={`/api/reports/export/monthly/${month}`}>⬇ Export monthly CSV</a>
        <label style={{ marginLeft: 16 }}>Year
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{ width: 90 }}
          />
        </label>
        <a className="btn ghost" href={`/api/reports/export/yearly/${year}`}>⬇ Export yearly CSV</a>
      </div>

      {monthly && (
        <>
          <h2>{monthly.month} summary</h2>
          <div className="stats-row">
            <div className="card stat"><div className="stat-label">Income</div><div className="stat-value income">{eur(monthly.totals.income)}</div></div>
            <div className="card stat"><div className="stat-label">Expenses</div><div className="stat-value expense">{eur(Math.abs(monthly.totals.expenses))}</div></div>
            <div className="card stat"><div className="stat-label">Transactions</div><div className="stat-value">{monthly.totals.n}</div></div>
          </div>
          <div className="card table-card">
            <table>
              <thead>
                <tr><th>Category</th><th>Spent</th><th>Budget</th><th>Variance</th></tr>
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
            <div className="card stat"><div className="stat-label">Income</div><div className="stat-value income">{eur(yearly.totals.income)}</div></div>
            <div className="card stat"><div className="stat-label">Expenses</div><div className="stat-value expense">{eur(Math.abs(yearly.totals.expenses))}</div></div>
            <div className="card stat">
              <div className="stat-label">vs {yearly.year - 1}</div>
              <div className={`stat-value ${Math.abs(yearly.totals.expenses) <= Math.abs(yearly.prevYearExpenses) ? 'income' : 'expense'}`}>
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
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
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
                    data={yearly.byCategory.map((c, i) => ({ name: c.name, value: Math.abs(c.spent), color: PALETTE[i % PALETTE.length] }))}
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
                <thead><tr><th>Category</th><th>Spent</th></tr></thead>
                <tbody>
                  {yearly.byCategory.map((c, i) => (
                    <tr key={c.name}>
                      <td><span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} /> {c.name}</td>
                      <td className="expense">{eur(c.spent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
