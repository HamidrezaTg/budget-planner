import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, formatMoney, monthLabel } from '../api.js';

export default function Shared() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get(`/share/${encodeURIComponent(token)}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [token]);

  if (!data) return <div className="login-wrap">{error || 'Loading shared budget…'}</div>;
  return (
    <div className="login-wrap">
      <main className="card" style={{ width: 'min(760px, 100%)' }}>
        <p className="eyebrow">Budget Planner</p>
        <h1>{monthLabel(data.month)} budget</h1>
        <p className="muted">Read-only view · {data.currency}</p>
        <div className="stat-value" style={{ margin: '18px 0' }}>
          {formatMoney(data.planned_total, data.currency)}
        </div>
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Group</th>
                <th className="num">Planned</th>
              </tr>
            </thead>
            <tbody>
              {data.categories.map((category) => (
                <tr key={`${category.group}:${category.name}`}>
                  <td>{category.name}</td>
                  <td className="muted">{category.group}</td>
                  <td className="num">{formatMoney(category.planned, data.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
