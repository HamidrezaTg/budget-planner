import React, { useEffect, useState } from 'react';
import {
  ComposedChart, Area, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { api, eur, currentMonth } from '../api.js';

const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const label = (m) => `${monthNames[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`;

export default function Projection() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/projection?months=96').then(setData);
  }, []);

  if (!data) return <div className="loading">Loading…</div>;

  const chart = data.months.map((m) => ({
    name: label(m.month),
    free: m.free_savings,
    committed: m.committed_savings,
    total: Math.max(m.total_predicted, 0),
    net: m.net,
  }));

  const end = data.months[data.months.length - 1];

  return (
    <div>
      <h1>Projection to {data.months[data.months.length - 1].month}</h1>
      <p className="muted">
        Income minus outgoings rolled forward. Commitments drop out on their end dates.
        {data.anchored_at
          ? ` Re-anchored to your observed balance at ${data.anchored_at}.`
          : ' Enter real balances on the Balances page to anchor it to reality.'}
      </p>

      <div className="stats-row">
        <div className="card stat">
          <div className="stat-label">Predicted balance at horizon</div>
          <div className={`stat-value ${end.total_predicted >= 0 ? 'income' : 'expense'}`}>
            {eur(end.total_predicted)}
          </div>
        </div>
        <div className="card stat">
          <div className="stat-label">Avg monthly net (next 12)</div>
          <div className="stat-value">
            {eur(data.months.slice(0, 12).reduce((s, m) => s + m.net, 0) / 12)}
          </div>
        </div>
      </div>

      <div className="card chart-card" style={{ marginTop: 14 }}>
        <ResponsiveContainer width="100%" height={360}>
          <ComposedChart data={chart}>
            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={2} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => eur(v)} />
            <Legend />
            <Area dataKey="committed" stackId="1" fill="#6366f1" stroke="#6366f1" name="Committed (funds)" fillOpacity={0.7} />
            <Area dataKey="free" stackId="1" fill="#22d3ee" stroke="#22d3ee" name="Free savings" fillOpacity={0.7} />
            <Bar dataKey="net" fill="rgba(251,191,36,0.25)" stroke="#fbbf24" name="Monthly net" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="card table-card tight">
        <table>
          <thead>
            <tr>
              <th>Month</th><th className="num">Income</th><th className="num">Commitments</th>
              <th className="num">Variable</th><th className="num">Net</th>
              <th className="num">Free</th><th className="num">Committed</th><th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.months.filter((_, i) => i % 3 === 0 || i < 6).map((m) => (
              <tr key={m.month}>
                <td>{m.month}</td>
                <td className="num">{eur(m.income)}</td>
                <td className="num">{eur(m.commitments)}</td>
                <td className="num">{eur(m.variable)}</td>
                <td className={`num ${m.net >= 0 ? 'income' : 'expense'}`}>{eur(m.net)}</td>
                <td className={`num ${m.free_savings < 0 ? 'bad' : ''}`}>{eur(m.free_savings)}</td>
                <td className="num">{eur(m.committed_savings)}</td>
                <td className={`num ${m.total_predicted < 0 ? 'bad' : ''}`}><b>{eur(m.total_predicted)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
