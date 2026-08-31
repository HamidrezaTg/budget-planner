import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, currentMonth, eur, monthLabel, setCurrency } from './api.js';

describe('client API helpers', () => {
  beforeEach(() => {
    const values = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    });
    vi.stubGlobal('window', { location: { href: '' } });
  });

  it('formats amounts using the selected currency', () => {
    expect(eur(1234.5)).toContain('1.234,50');
    setCurrency('USD');
    expect(eur(12.5)).toContain('12,50');
  });

  it('formats month labels and the current month', () => {
    expect(monthLabel('2026-05')).toBe('May 2026');
    expect(currentMonth()).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });

  it('sends JSON requests and returns the decoded response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      }),
    );

    await expect(api.post('/transactions', { amount: -5 })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith('/api/transactions', {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      method: 'POST',
      body: JSON.stringify({ amount: -5 }),
    });
  });
});
