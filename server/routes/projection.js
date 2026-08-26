import { Router } from 'express';
import { project } from '../services/model.js';

const router = Router();

router.get('/', (req, res) => {
  const months = Math.min(Math.max(Number(req.query.months) || 96, 1), 240);
  const from = /^\d{4}-\d{2}$/.test(req.query.from ?? '') ? req.query.from : undefined;
  res.json(project(months, from));
});

export default router;
