import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, eur, currentMonth, monthLabel } from '../api.js';

const GROUP_COLORS = {
  Housing: '#3157d5',
  Food: '#b8d93b',
  Personal: '#9c6ade',
  Entertainment: '#e9a23b',
  Transport: '#6983e3',
  Loans: '#ef6b6e',
  Savings: '#3c8648',
};

export default function Dashboard() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState(null);
  const [upcoming, setUpcoming] = useState(null);

  useEffect(() => {
    api.get(`/dashboard/${month}`).then(setData).catch(() => {});
  }, [month]);

  useEffect(() => {
    if (month === currentMonth()) {
      api.get('/recurrences').then((r) => setUpcoming(r.upcoming)).catch(() => {});
    } else {
      setUpcoming(null);
    }
  }, [month]);

  if (!data) return <div className="loading">Loading…</div>;

  const shiftMonth = (delta) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const spentPct =
    data.planned_total > 0
      ? Math.min(100, (data.actual_total / data.planned_total) * 100)
      : 0;
  const isCurrent = month === currentMonth();
  const now = new Date();

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="eyebrow">Monthly check-in</p>
          <h1>{monthLabel(month)}</h1>
          <p className="muted">
            Planned {eur(data.planned_total)} · Actual {eur(data.actual_total)} · Income {eur(data.income)}
          </p>
        </div>
        <div className="month-nav">
          <button className="btn" aria-label="Previous month" onClick={() => shiftMonth(-1)}>‹</button>
          <strong>{isCurrent ? 'This month' : monthLabel(month)}</strong>
          <button className="btn" aria-label="Next month" onClick={() => shiftMonth(1)}>›</button>
          {!isCurrent && (
            <button
              className="btn"
              title={`Back to ${monthLabel(currentMonth())}`}
              onClick={() => setMonth(currentMonth())}
            >
              {monthLabel(currentMonth()).split(' ')[0]}
            </button>
          )}
          {data.notification_count > 0 && (
            <a className="notification-pill" href="#insights" aria-label={`${data.notification_count} dashboard alerts`}>
              <span className="notification-dot" />
              {data.notification_count} alert{data.notification_count === 1 ? '' : 's'}
            </a>
          )}
        </div>
      </div>

      <div className="stats-row">
        <div className="card stat highlight">
          <div className="stat-label"><span>Transfer to Revolut</span></div>
          <div className="stat-value">{eur(data.transfer_to_revolut)}</div>
          <p>move this amount to your spending account</p>
          <div className="safe-meter">
            <i style={{ width: `${spentPct}%` }} />
          </div>
        </div>
        <div className="card stat">
          <div className="stat-label"><span>Income (actual)</span></div>
          <div className="stat-value income">{eur(data.income)}</div>
          <p>entered on the Income page</p>
        </div>
        <div className="card stat">
          <div className="stat-label"><span>Spent</span></div>
          <div className="stat-value">{eur(data.actual_total)}</div>
          <p>of {eur(data.planned_total)} planned · {Math.round(spentPct)}%</p>
        </div>
        <div className="card stat">
          <div className="stat-label"><span>Month result</span></div>
          <div className={`stat-value ${data.month_result >= 0 ? 'income' : 'expense'}`}>
            {data.month_result >= 0 ? '+' : ''}{eur(data.month_result)}
          </div>
          <p>{data.month_result >= 0 ? 'under' : 'over'} the plan, all groups</p>
        </div>
        <Link to="/transactions?review=1" className="card stat review-link">
          <div className="stat-label"><span>Needs review</span></div>
          <div className={`stat-value ${data.warnings.needs_review > 0 ? 'warn' : ''}`}>
            {data.warnings.needs_review}
          </div>
          <p>transactions to categorize</p>
        </Link>
      </div>

      {(data.warnings.untagged_categories.length > 0 || data.warnings.needs_review > 0) && (
        <div className="card warn-box">
          {data.warnings.needs_review > 0 && (
            <div>
              <Link to="/transactions?review=1">
                {data.warnings.needs_review} transaction(s) need a category
              </Link>
            </div>
          )}
          {data.warnings.untagged_categories.length > 0 && (
            <div>
              Categories without an account (their spending vanishes from account totals):{' '}
              <Link to="/budgets">{data.warnings.untagged_categories.join(', ')}</Link>
            </div>
          )}
        </div>
      )}

      {data.insights?.length > 0 && (
        <section id="insights" className="insight-section" aria-label="Budget insights">
          <div className="section-kicker">
            <div>
              <p className="eyebrow">Worth a look</p>
              <h2>Insights</h2>
            </div>
            <span className="muted">Generated from your plan and activity</span>
          </div>
          <div className="insight-grid">
            {data.insights.map((insight, i) => (
              <div key={`${insight.kind}-${i}`} className={`insight-card ${insight.severity}`}>
                <div className="insight-mark" aria-hidden="true">
                  {insight.severity === 'danger' ? '!' : insight.severity === 'warning' ? '△' : '·'}
                </div>
                <div className="insight-copy">
                  <strong>{insight.title}</strong>
                  <p>{insight.message}</p>
                  <Link to={insight.link}>{insight.action} <span aria-hidden="true">→</span></Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {isCurrent && upcoming?.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Coming up</p>
              <h2>Expected this & next month</h2>
            </div>
            <span className="count-pill">{upcoming.length} items</span>
          </div>
          {upcoming.slice(0, 8).map((u, i) => (
            <div key={i} className="bill-row">
              <div className="bill-date"><strong>{String(u.day).padStart(2, '0')}</strong><span>{u.month.slice(5)}</span></div>
              <div className="transaction-main">
                <strong>{u.name}</strong>
                <small>{u.auto_post ? 'auto-posts' : 'confirm on Recurring page'}</small>
              </div>
              <b className={u.amount >= 0 ? 'income' : ''}>{eur(u.amount)}</b>
            </div>
          ))}
        </div>
      )}

      {data.groups.map((g) => {
        const color = GROUP_COLORS[g.name] || '#8d94a2';
        return (
          <div key={g.name} className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">{g.name}</p>
                <h2>
                  {eur(g.actual)}{' '}
                  <span className="muted" style={{ fontSize: 14 }}>
                    of {eur(g.planned)} planned
                  </span>
                </h2>
              </div>
              <span className={g.difference >= 0 ? 'count-pill good' : 'count-pill bad'}>
                {g.difference >= 0 ? `${eur(g.difference)} under` : `${eur(-g.difference)} over`}
              </span>
            </div>
            {g.rows.map((r) => {
              const pct = r.planned > 0 ? Math.min(100, (r.actual / r.planned) * 100) : r.actual > 0 ? 100 : 0;
              return (
                <div key={r.id} className="category-row">
                  <div className="category-name">
                    <i style={{ background: color }} />
                    <span>{r.name}</span>
                    <strong>{eur(r.actual)}</strong>
                  </div>
                  <div className="progress-track">
                    <i
                      style={{
                        width: `${pct}%`,
                        background: r.planned > 0 && r.actual > r.planned ? 'var(--red)' : color,
                      }}
                    />
                  </div>
                  <div className="category-meta">
                    <span>{r.planned > 0 ? `${Math.round((r.actual / r.planned) * 100)}% used` : 'no plan'}</span>
                    <span>
                      {r.planned > 0
                        ? r.difference >= 0
                          ? `${eur(r.difference)} left`
                          : `${eur(-r.difference)} over`
                        : r.actual > 0
                          ? 'untagged plan'
                          : ''}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
