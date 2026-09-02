// Shared OpenAI-compatible chat client + per-user AI configuration.
import { currentProfileConfig } from './ai-profiles.js';

// Base URLs of the built-in providers, whose error bodies are safe to surface
// verbatim (their hosts are fixed, not user-chosen). Anything else is a custom
// endpoint that can point at internal services — its responses must never be
// echoed to the client, or any user gains a read primitive against the
// server's network (SSRF).
const KNOWN_PROVIDER_BASES = new Set([
  'https://api.openai.com/v1',
  'https://api.anthropic.com/v1',
  'https://openrouter.ai/api/v1',
  'https://opencode.ai/zen/v1',
  'https://api.groq.com/openai/v1',
  'https://api.deepseek.com/v1',
  'https://api.mistral.ai/v1',
  'https://api.together.xyz/v1',
  'http://localhost:11434/v1',
  'http://localhost:1234/v1',
  'http://localhost:20128/v1',
]);

export function isTrustedBaseUrl(url) {
  return KNOWN_PROVIDER_BASES.has(String(url || '').replace(/\/+$/, ''));
}

export function getAiConfig(username) {
  const profile = currentProfileConfig(username);
  return {
    baseUrl: String(profile.base_url || '').replace(/\/+$/, ''),
    apiKey: profile.api_key || '',
    model: profile.model,
    provider: profile.provider,
    profileId: profile.profile_id,
    profileName: profile.name,
    shared: profile.shared,
  };
}

async function post(path, body, cfg, extra = {}) {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({ ...body, ...extra }),
    // A hung provider must not hold a request (and its session) for the
    // undici default of several minutes.
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // kept on `raw` only for internal retry heuristics — never sent to clients
    const err = new Error(
      `AI request failed (HTTP ${res.status})` +
        (isTrustedBaseUrl(cfg.baseUrl) && text ? `: ${text.slice(0, 300)}` : ''),
    );
    err.status = 502;
    err.raw = text;
    throw err;
  }
  return res.json();
}

// One chat-completions call. Returns the assistant message object
// ({ content, tool_calls? }).
// Reasoning models (e.g. gpt-5.x) reject function tools unless
// reasoning_effort is "none" — retry automatically when the provider says so.
export async function chatComplete(cfg, messages, tools) {
  const body = { model: cfg.model, messages };
  if (tools && tools.length) body.tools = tools;
  try {
    const data = await post('/chat/completions', body, cfg);
    return data.choices?.[0]?.message ?? { content: '' };
  } catch (e) {
    if (tools && tools.length && /reasoning_effort/i.test(e.raw ?? e.message)) {
      const data = await post('/chat/completions', body, cfg, { reasoning_effort: 'none' });
      return data.choices?.[0]?.message ?? { content: '' };
    }
    throw e;
  }
}

// Extract a JSON object/array from a model reply that may contain prose or
// markdown fences.
export function parseJsonLoose(text) {
  if (!text) throw new Error('Empty AI response');
  const cleaned = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {}
  const start = Math.min(...[cleaned.indexOf('{'), cleaned.indexOf('[')].filter((i) => i >= 0));
  const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  if (Number.isFinite(start) && end > start) {
    return JSON.parse(cleaned.slice(start, end + 1));
  }
  throw new Error(`Could not parse AI response as JSON: ${text.slice(0, 200)}`);
}
