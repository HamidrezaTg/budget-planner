import { useEffect, useState } from 'react';
import {
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Line,
  ResponsiveContainer,
} from 'recharts';
import { api, eur, currentMonth } from '../api.js';

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
const label = (m) => `${monthNames[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`;
const scenarioColors = ['#3157d5', '#e9a23b', '#9c6ade'];
const blankScenario = () => ({
  name: '',
  monthly_income_delta: '0',
  monthly_outgoings_delta: '0',
  one_offs: [],
});

export default function Projection() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [horizon, setHorizon] = useState('96');
  const [scenarioForms, setScenarioForms] = useState(() => [blankScenario()]);
  const [scenarioData, setScenarioData] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .get('/projection?months=96')
      .then((projection) => {
        setData(projection);
        setHorizon(String(projection.horizon));
      })
      .catch((e) => setError(e.message));
  }, []);

  const updateScenario = (index, patch) => {
    setScenarioForms((previous) =>
      previous.map((scenario, scenarioIndex) =>
        scenarioIndex === index ? { ...scenario, ...patch } : scenario,
      ),
    );
  };

  const updateOneOff = (scenarioIndex, oneOffIndex, patch) => {
    setScenarioForms((previous) =>
      previous.map((scenario, index) =>
        index === scenarioIndex
          ? {
              ...scenario,
              one_offs: scenario.one_offs.map((oneOff, index) =>
                index === oneOffIndex ? { ...oneOff, ...patch } : oneOff,
              ),
            }
          : scenario,
      ),
    );
  };

  const submitScenarios = async (event) => {
    event.preventDefault();
    const numericHorizon = Number(horizon);
    if (!Number.isInteger(numericHorizon) || numericHorizon < 1 || numericHorizon > 240) {
      setError('Horizon must be a whole number from 1 to 240.');
      return;
    }
    if (scenarioForms.some((scenario) => !scenario.name.trim())) {
      setError('Each scenario needs a name.');
      return;
    }
    if (
      scenarioForms.some(
        (scenario) =>
          scenario.monthly_income_delta === '' ||
          scenario.monthly_outgoings_delta === '' ||
          !Number.isFinite(Number(scenario.monthly_income_delta)) ||
          !Number.isFinite(Number(scenario.monthly_outgoings_delta)),
      )
    ) {
      setError('Monthly deltas must be numbers.');
      return;
    }
    if (
      scenarioForms.some((scenario) =>
        scenario.one_offs.some((oneOff) => !oneOff.month || oneOff.amount === ''),
      )
    ) {
      setError('Complete or remove every one-off row.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const result = await api.post('/projection/scenarios', {
        horizon: numericHorizon,
        scenarios: scenarioForms.map((scenario) => ({
          name: scenario.name.trim(),
          monthly_income_delta: Number(scenario.monthly_income_delta),
          monthly_outgoings_delta: Number(scenario.monthly_outgoings_delta),
          one_offs: scenario.one_offs.map((oneOff) => ({
            month: oneOff.month,
            amount: Number(oneOff.amount),
          })),
        })),
      });
      setData(result.baseline);
      setScenarioData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!data)
    return <div className="loading">{error ? `Failed to load: ${error}` : 'Loading…'}</div>;

  const comparedScenarios = scenarioData?.scenarios ?? [];
  const chart = data.months.map((m, monthIndex) => ({
    name: label(m.month),
    free: m.free_savings,
    committed: m.committed_savings,
    baselineTotal: m.total_predicted,
    net: m.net,
    ...Object.fromEntries(
      comparedScenarios.map((scenario, index) => [
        `scenario${index}`,
        scenario.projection.months[monthIndex]?.total_predicted,
      ]),
    ),
  }));

  const end = data.months[data.months.length - 1];
  const baselineEnd = end.total_predicted;

  return (
    <div>
      <h1>Projection to {data.months[data.months.length - 1].month}</h1>
      <p className="muted">
        Income minus outgoings rolled forward. Commitments drop out on their end dates.
        {data.anchored_at
          ? ` Re-anchored to your observed balance at ${data.anchored_at}.`
          : ' Enter real balances on the Balances page to anchor it to reality.'}
      </p>

      <div className="card scenario-builder">
        <div className="panel-head">
          <div>
            <p className="eyebrow">What if?</p>
            <h2>Compare forecast scenarios</h2>
            <p className="muted">
              These changes are temporary and do not alter your budgets, income, or transactions.
              Positive outgoings deltas and one-offs add spending.
            </p>
          </div>
          <label className="scenario-horizon">
            Horizon (months)
            <input
              type="number"
              min="1"
              max="240"
              step="1"
              value={horizon}
              onChange={(event) => setHorizon(event.target.value)}
            />
          </label>
        </div>
        <form onSubmit={submitScenarios}>
          <div className="scenario-grid">
            {scenarioForms.map((scenario, index) => (
              <div className="scenario-card" key={index}>
                <div className="scenario-card-head">
                  <strong style={{ borderColor: scenarioColors[index] }}>
                    Scenario {index + 1}
                  </strong>
                  {scenarioForms.length > 1 && (
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() =>
                        setScenarioForms((previous) => previous.filter((_, item) => item !== index))
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
                <input
                  required
                  aria-label={`Scenario ${index + 1} name`}
                  placeholder="Name, e.g. New job"
                  value={scenario.name}
                  onChange={(event) => updateScenario(index, { name: event.target.value })}
                />
                <div className="scenario-deltas">
                  <label>
                    Monthly income change
                    <input
                      type="number"
                      step="0.01"
                      value={scenario.monthly_income_delta}
                      onChange={(event) =>
                        updateScenario(index, { monthly_income_delta: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Monthly outgoings change
                    <input
                      type="number"
                      step="0.01"
                      value={scenario.monthly_outgoings_delta}
                      onChange={(event) =>
                        updateScenario(index, { monthly_outgoings_delta: event.target.value })
                      }
                    />
                  </label>
                </div>
                <div className="one-off-head">
                  <span>One-off outgoings</span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      updateScenario(index, {
                        one_offs: [
                          ...scenario.one_offs,
                          { month: data.from || currentMonth(), amount: '' },
                        ],
                      })
                    }
                  >
                    + Add one-off
                  </button>
                </div>
                {scenario.one_offs.map((oneOff, oneOffIndex) => (
                  <div className="one-off-row" key={oneOffIndex}>
                    <input
                      type="month"
                      aria-label="One-off month"
                      value={oneOff.month}
                      onChange={(event) =>
                        updateOneOff(index, oneOffIndex, { month: event.target.value })
                      }
                    />
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Amount"
                      aria-label="One-off amount"
                      value={oneOff.amount}
                      onChange={(event) =>
                        updateOneOff(index, oneOffIndex, { amount: event.target.value })
                      }
                    />
                    <button
                      type="button"
                      className="btn ghost small"
                      aria-label="Remove one-off"
                      onClick={() =>
                        updateScenario(index, {
                          one_offs: scenario.one_offs.filter((_, item) => item !== oneOffIndex),
                        })
                      }
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="scenario-actions">
            <button
              type="button"
              className="btn ghost"
              disabled={scenarioForms.length >= 3}
              onClick={() => setScenarioForms((previous) => [...previous, blankScenario()])}
            >
              + Add scenario
            </button>
            <button type="submit" className="btn primary" disabled={submitting}>
              {submitting ? 'Comparing…' : 'Compare scenarios'}
            </button>
          </div>
        </form>
        {error && <p className="error scenario-error">{error}</p>}
      </div>

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
            {/* ~8 x labels maximum: with all 96 months rendered the axis was a
                solid black smear on phone-width charts. */}
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10 }}
              interval={Math.max(Math.ceil(chart.length / 8) - 1, 0)}
            />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => eur(v)} />
            <Legend />
            <Area
              dataKey="committed"
              stackId="1"
              fill="#6366f1"
              stroke="#6366f1"
              name="Committed (funds)"
              fillOpacity={0.7}
            />
            <Area
              dataKey="free"
              stackId="1"
              fill="#22d3ee"
              stroke="#22d3ee"
              name="Free savings"
              fillOpacity={0.7}
            />
            <Bar dataKey="net" fill="rgba(251,191,36,0.25)" stroke="#fbbf24" name="Monthly net" />
            <Line
              dataKey="baselineTotal"
              stroke="#72798a"
              strokeWidth={2}
              dot={false}
              name="Baseline total"
            />
            {comparedScenarios.map((scenario, index) => (
              <Line
                key={`scenario-line-${index}`}
                dataKey={`scenario${index}`}
                stroke={scenarioColors[index]}
                strokeWidth={2.5}
                dot={false}
                name={scenario.name}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="card table-card tight">
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Income</th>
              <th className="num">Commitments</th>
              <th className="num">Variable</th>
              <th className="num">Net</th>
              <th className="num">Free</th>
              <th className="num">Committed</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.months
              .filter((_, i) => i % 3 === 0 || i < 6)
              .map((m) => (
                <tr key={m.month}>
                  <td>{m.month}</td>
                  <td className="num">{eur(m.income)}</td>
                  <td className="num">{eur(m.commitments)}</td>
                  <td className="num">{eur(m.variable)}</td>
                  <td className={`num ${m.net >= 0 ? 'income' : 'expense'}`}>{eur(m.net)}</td>
                  <td className={`num ${m.free_savings < 0 ? 'bad' : ''}`}>
                    {eur(m.free_savings)}
                  </td>
                  <td className="num">{eur(m.committed_savings)}</td>
                  <td className={`num ${m.total_predicted < 0 ? 'bad' : ''}`}>
                    <b>{eur(m.total_predicted)}</b>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {comparedScenarios.length > 0 && (
        <div className="card table-card scenario-results">
          <div className="scenario-results-head">
            <div>
              <p className="eyebrow">At {end.month}</p>
              <h2>Scenario comparison</h2>
            </div>
            <span className="muted tiny">Compared with the baseline above</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Scenario</th>
                <th className="num">Horizon balance</th>
                <th className="num">Change</th>
                <th className="num">Cumulative net</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Baseline</td>
                <td className="num">{eur(baselineEnd)}</td>
                <td className="num muted">—</td>
                <td className="num">
                  {eur(data.months.reduce((sum, month) => sum + month.net, 0))}
                </td>
              </tr>
              {comparedScenarios.map((scenario, index) => {
                const scenarioEnd =
                  scenario.projection.months[scenario.projection.months.length - 1];
                const change = scenarioEnd.total_predicted - baselineEnd;
                return (
                  <tr key={`scenario-result-${index}`}>
                    <td>
                      <span
                        className="scenario-dot"
                        style={{ background: scenarioColors[index] }}
                      />
                      {scenario.name}
                    </td>
                    <td className={`num ${scenarioEnd.total_predicted < 0 ? 'bad' : ''}`}>
                      {eur(scenarioEnd.total_predicted)}
                    </td>
                    <td className={`num ${change >= 0 ? 'income' : 'expense'}`}>{eur(change)}</td>
                    <td className="num">
                      {eur(scenario.projection.months.reduce((sum, month) => sum + month.net, 0))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
