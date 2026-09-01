import { Router } from 'express';
import { project } from '../services/model.js';

const router = Router();
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const SCENARIO_FIELDS = new Set([
  'name',
  'monthly_income_delta',
  'monthly_outgoings_delta',
  'one_offs',
]);

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateScenarioRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body must be an object';
  }
  if (Object.keys(body).some((key) => !['horizon', 'scenarios'].includes(key))) {
    return 'Request contains an unknown field';
  }
  if (!Number.isInteger(body.horizon) || body.horizon < 1 || body.horizon > 240) {
    return 'horizon must be an integer from 1 to 240';
  }
  if (!Array.isArray(body.scenarios) || body.scenarios.length < 1 || body.scenarios.length > 3) {
    return 'scenarios must contain between 1 and 3 scenarios';
  }

  for (let index = 0; index < body.scenarios.length; index++) {
    const scenario = body.scenarios[index];
    const prefix = `scenarios[${index}]`;
    if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) {
      return `${prefix} must be an object`;
    }
    if (Object.keys(scenario).some((key) => !SCENARIO_FIELDS.has(key))) {
      return `${prefix} contains an unknown field`;
    }
    if (
      typeof scenario.name !== 'string' ||
      scenario.name.trim().length < 1 ||
      scenario.name.length > 80
    ) {
      return `${prefix}.name must be a 1-80 character string`;
    }
    for (const field of ['monthly_income_delta', 'monthly_outgoings_delta']) {
      if (!isFiniteNumber(scenario[field])) return `${prefix}.${field} must be a finite number`;
    }
    if (!Array.isArray(scenario.one_offs)) return `${prefix}.one_offs must be an array`;
    for (let oneOffIndex = 0; oneOffIndex < scenario.one_offs.length; oneOffIndex++) {
      const oneOff = scenario.one_offs[oneOffIndex];
      const oneOffPrefix = `${prefix}.one_offs[${oneOffIndex}]`;
      if (!oneOff || typeof oneOff !== 'object' || Array.isArray(oneOff)) {
        return `${oneOffPrefix} must be an object`;
      }
      if (Object.keys(oneOff).some((key) => !['month', 'amount'].includes(key))) {
        return `${oneOffPrefix} contains an unknown field`;
      }
      if (typeof oneOff.month !== 'string' || !MONTH_RE.test(oneOff.month)) {
        return `${oneOffPrefix}.month must be YYYY-MM`;
      }
      if (!isFiniteNumber(oneOff.amount)) return `${oneOffPrefix}.amount must be a finite number`;
    }
  }
  return null;
}

router.get('/', (req, res) => {
  const months = Math.min(Math.max(Number(req.query.months) || 96, 1), 240);
  const from = /^\d{4}-\d{2}$/.test(req.query.from ?? '') ? req.query.from : undefined;
  res.json(project(months, from));
});

router.post('/scenarios', (req, res) => {
  const error = validateScenarioRequest(req.body);
  if (error) return res.status(400).json({ error });

  const baseline = project(req.body.horizon);
  res.json({
    baseline,
    scenarios: req.body.scenarios.map((scenario) => ({
      ...scenario,
      name: scenario.name.trim(),
      projection: project(baseline.horizon, baseline.from, scenario),
    })),
  });
});

export default router;
