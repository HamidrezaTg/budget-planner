import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, eur, currentMonth, monthLabel } from '../api.js';
import { useWorkingMonth } from '../components/WorkingMonth.jsx';

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
  const { month, setMonth } = useWorkingMonth();
  const [data, setData] = useState(null);
  const [upcoming, setUpcoming] = useState(null);

  useEffect(() => {
    api.post('/reports/history/capture').catch(() => {});
    api
      .get(`/dashboard/${month}`)
      .then(setData)
      .catch(() => {});
  }, [month]);

  useEffect(() => {
    if (month === currentMonth()) {
      api
        .post('/recurrences/auto-post')
        .then(() => api.get('/recurrences'))
        .then((r) => setUpcoming(r.upcoming))
        .catch(() => {});
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

  const budgetActualTotal = data.budget_actual_total ?? data.actual_total;
  const coveredTotal = (data.fund_covered_total ?? 0) + (data.commitment_covered_total ?? 0);
  const spentPct =
    data.planned_total > 0 ? Math.min(100, (budgetActualTotal / data.planned_total) * 100) : 0;
  const isCurrent = month === currentMonth();

  // Server sends raw numbers in `fields`; format here so amounts follow the
  // currency chosen on the Settings page.
  const insightText = (ins) => {
    const f = ins.fields ?? {};
    switch (ins.kind) {
      case 'over-budget':
        return `${eur(f.amount_over)} over its planned budget.`;
      case 'pace':
        return `${f.spent_pct}% of plan used · ${f.elapsed_pct}% of month elapsed.`;
      case 'fund-goal':
        return `${eur(f.monthly_needed)} per month needed to reach ${eur(f.target)}.`;
      case 'fund-overdue':
        return `${f.months_late} month${f.months_late === 1 ? '' : 's'} past target — still ${eur(f.missing)} short.`;
      default:
        return ins.message || '';
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="eyebrow">Monthly check-in</p>
          <h1>{monthLabel(month)}</h1>
          <p className="muted">
            Categories {eur(data.planned_total)} · funds set aside{' '}
            {eur(data.fund_contribution_total ?? 0)}
            {' · '}planned cash outflows {eur(data.planned_cash_outflows ?? data.planned_total)} ·
            Spent {eur(data.actual_total)} · Income {eur(data.income)}
          </p>
        </div>
        <div className="month-nav">
          <button className="btn" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
            ‹
          </button>
          <strong>{isCurrent ? 'This month' : monthLabel(month)}</strong>
          <button className="btn" aria-label="Next month" onClick={() => shiftMonth(1)}>
            ›
          </button>
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
            <a
              className="notification-pill"
              href="#insights"
              aria-label={`${data.notification_count} dashboard alerts`}
            >
              <span className="notification-dot" />
              {data.notification_count} alert{data.notification_count === 1 ? '' : 's'}
            </a>
          )}
        </div>
      </div>

      <div className="stats-row">
        <div className="card stat highlight">
          <div className="stat-label">
            <span>Still to transfer to Revolut</span>
          </div>
          <div className="stat-value">{eur(data.transfer_to_revolut)}</div>
          <p>{eur(data.completed_transfer_to_revolut)} already transferred this month</p>
          <div className="safe-meter">
            <i style={{ width: `${spentPct}%` }} />
          </div>
        </div>
        <div className="card stat">
          <div className="stat-label">
            <span>Income (actual)</span>
          </div>
          <div className="stat-value income">{eur(data.income)}</div>
          <p>entered on the Income page</p>
        </div>
        <div className="card stat">
          <div className="stat-label">
            <span>Spent</span>
          </div>
          <div className="stat-value">{eur(data.actual_total)}</div>
          <p>
            {eur(budgetActualTotal)} charged to categories · {eur(coveredTotal)} linked funding
          </p>
        </div>
        <div className="card stat">
          <div className="stat-label">
            <span>Month result</span>
          </div>
          <div
            className={`stat-value ${(data.budget_result ?? data.month_result) >= 0 ? 'income' : 'expense'}`}
          >
            {(data.budget_result ?? data.month_result) >= 0 ? '+' : ''}
            {eur(data.budget_result ?? data.month_result)}
          </div>
          <p>
            {(data.budget_result ?? data.month_result) >= 0 ? 'under' : 'over'} the category plan
          </p>
        </div>
        <Link to="/transactions?review=1" className="card stat review-link">
          <div className="stat-label">
            <span>Needs review</span>
          </div>
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
                  <p>{insightText(insight)}</p>
                  <Link to={insight.link}>
                    {insight.action} <span aria-hidden="true">→</span>
                  </Link>
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
              <div className="bill-date">
                <strong>{String(u.day).padStart(2, '0')}</strong>
                <span>{u.month.slice(5)}</span>
              </div>
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
                    spent · {eur(g.budget_actual ?? g.actual)} charged to plan
                  </span>
                </h2>
              </div>
              <span
                className={
                  (g.budget_difference ?? g.difference) >= 0 ? 'count-pill good' : 'count-pill bad'
                }
              >
                {(g.budget_difference ?? g.difference) >= 0
                  ? `${eur(g.budget_difference ?? g.difference)} under`
                  : `${eur(-(g.budget_difference ?? g.difference))} over`}
              </span>
            </div>
            {g.rows.map((r) => {
              const budgetActual = r.budget_actual ?? r.actual;
              const covered = (r.fund_covered ?? 0) + (r.commitment_covered ?? 0);
              const pct =
                r.planned > 0
                  ? Math.min(100, (budgetActual / r.planned) * 100)
                  : budgetActual > 0
                    ? 100
                    : 0;
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
                        background:
                          r.planned > 0 && budgetActual > r.planned ? 'var(--red)' : color,
                      }}
                    />
                  </div>
                  <div className="category-meta">
                    <span>
                      {r.planned > 0
                        ? `${Math.round((budgetActual / r.planned) * 100)}% of plan used`
                        : 'no plan'}
                    </span>
                    <span>
                      {covered > 0
                        ? `${r.fund_covered > 0 ? `Fund ${eur(r.fund_covered)}` : ''}${r.commitment_covered > 0 ? `${r.fund_covered > 0 ? ' · ' : ''}Commitment ${eur(r.commitment_covered)}` : ''}${r.planned > 0 ? ` · ${eur(Math.max(0, r.planned - budgetActual))} left` : ''}`
                        : r.planned > 0
                          ? budgetActual <= r.planned
                            ? `${eur(r.planned - budgetActual)} left`
                            : `${eur(budgetActual - r.planned)} over`
                          : budgetActual > 0
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
