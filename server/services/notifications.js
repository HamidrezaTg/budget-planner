import { db, getSetting, getUserDb, listUsernames, als } from '../db.js';
import { currentMonth, monthView } from './model.js';

const SERVER_RE = /^https?:\/\//i;
const TOPIC_RE = /^[A-Za-z0-9._-]{1,128}$/;

export function validateNtfyConfig({ server, topic }) {
  const cleanServer = String(server ?? '')
    .trim()
    .replace(/\/+$/, '');
  const cleanTopic = String(topic ?? '').trim();
  if (!SERVER_RE.test(cleanServer))
    throw new Error('ntfy server must start with http:// or https://');
  if (!TOPIC_RE.test(cleanTopic))
    throw new Error('ntfy topic may contain only letters, numbers, ., _, and -');
  return { server: cleanServer, topic: cleanTopic };
}

export function ntfyConfig() {
  return {
    enabled: getSetting('ntfy_enabled') === '1',
    server: getSetting('ntfy_server') || 'https://ntfy.sh',
    topic: getSetting('ntfy_topic') || '',
    token: getSetting('ntfy_token') || '',
  };
}

export async function publishNtfy({ server, topic, token, title, message }) {
  const target = validateNtfyConfig({ server, topic });
  const headers = { 'Content-Type': 'text/plain; charset=utf-8', Title: title };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${target.server}/${encodeURIComponent(target.topic)}`, {
    method: 'POST',
    headers,
    body: message,
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`ntfy returned HTTP ${response.status}`);
}

export async function sendDailySummary() {
  const config = ntfyConfig();
  if (!config.enabled || !config.topic) return false;
  const month = currentMonth();
  const eventKey = `daily-summary:${month}`;
  if (db.prepare('SELECT 1 FROM notification_deliveries WHERE event_key = ?').get(eventKey))
    return false;
  const insights = monthView(month).insights.filter((item) =>
    ['warning', 'danger'].includes(item.severity),
  );
  if (!insights.length) return false;
  const message = insights
    .map((item) => `${item.title}${item.message ? `: ${item.message}` : ''}`)
    .join('\n');
  await publishNtfy({
    ...config,
    title: `Budget Planner warnings for ${month}`,
    message,
  });
  db.prepare('INSERT INTO notification_deliveries (event_key, kind) VALUES (?, ?)').run(
    eventKey,
    'daily-summary',
  );
  return true;
}

export async function runNotificationSweep() {
  for (const username of listUsernames()) {
    const userDb = getUserDb(username);
    try {
      await als.run(userDb, () => sendDailySummary());
    } catch (error) {
      console.error(`[notifications] ${username}: ${error.message}`);
    }
  }
}
