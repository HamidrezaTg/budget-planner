import crypto from 'node:crypto';
import { als } from '../db.js';
import { master, getUserDb } from '../db.js';

// These providers all speak the chat-completions dialect used by the app.
// 9Router is normally a local gateway; OpenCode Zen documents its compatible
// endpoint at https://opencode.ai/zen/v1/chat/completions.
export const PROVIDERS = {
  openai: { label: 'OpenAI', base_url: 'https://api.openai.com/v1' },
  anthropic: { label: 'Anthropic (Claude)', base_url: 'https://api.anthropic.com/v1' },
  '9router': { label: '9Router (local)', base_url: 'http://localhost:20128/v1', no_key: true },
  opencode: { label: 'OpenCode Zen', base_url: 'https://opencode.ai/zen/v1' },
  openrouter: { label: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1' },
  groq: { label: 'Groq', base_url: 'https://api.groq.com/openai/v1' },
  deepseek: { label: 'DeepSeek', base_url: 'https://api.deepseek.com/v1' },
  mistral: { label: 'Mistral', base_url: 'https://api.mistral.ai/v1' },
  together: { label: 'Together AI', base_url: 'https://api.together.xyz/v1' },
  ollama: { label: 'Ollama (local)', base_url: 'http://localhost:11434/v1', no_key: true },
  lmstudio: { label: 'LM Studio (local)', base_url: 'http://localhost:1234/v1', no_key: true },
  custom: { label: 'Custom (enter URL)', base_url: '' },
};

export function baseUrlFor(provider, customUrl) {
  const definition = PROVIDERS[provider];
  if (!definition) throw new Error('Unknown provider');
  if (provider === 'custom') {
    const url = String(customUrl || '')
      .trim()
      .replace(/\/+$/, '');
    if (!url) throw new Error('Custom provider needs a Base URL');
    if (!/^https?:\/\//i.test(url))
      throw new Error('Custom Base URL must start with http:// or https://');
    return url;
  }
  return definition.base_url;
}

function currentUsername() {
  return als.getStore()?.__bpUsername || null;
}

export function userId(username) {
  return master.prepare('SELECT id FROM users WHERE username = ?').get(username)?.id ?? null;
}

function usernameForId(id) {
  return master.prepare('SELECT username FROM users WHERE id = ?').get(id)?.username ?? null;
}

function profileRow(ownerUsername, profileId) {
  if (!ownerUsername || !profileId) return null;
  return getUserDb(ownerUsername).prepare('SELECT * FROM ai_profiles WHERE id = ?').get(profileId);
}

// Convert the old four settings keys into a named profile once. Existing
// deployments keep working, but all subsequent writes use ai_profiles.
export function ensureLegacyProfile(username) {
  const ownerDb = getUserDb(username);
  const existing = ownerDb
    .prepare('SELECT * FROM ai_profiles ORDER BY created_at, id LIMIT 1')
    .get();
  if (existing) return existing;

  const legacy = ownerDb
    .prepare(
      "SELECT MAX(CASE WHEN key = 'ai_provider' THEN value END) provider, " +
        "MAX(CASE WHEN key = 'ai_base_url' THEN value END) base_url, " +
        "MAX(CASE WHEN key = 'ai_api_key' THEN value END) api_key, " +
        "MAX(CASE WHEN key = 'ai_model' THEN value END) model FROM settings",
    )
    .get();
  if (!legacy?.base_url && !legacy?.api_key && !legacy?.model) return null;

  const id = crypto.randomUUID();
  ownerDb
    .prepare(
      'INSERT INTO ai_profiles (id, name, provider, base_url, api_key, model) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      'Default',
      legacy.provider || 'custom',
      legacy.base_url || '',
      legacy.api_key || '',
      legacy.model || 'gpt-4o-mini',
    );
  setActiveProfile(username, userId(username), id);
  return profileRow(username, id);
}

export function profileView(row, ownerUsername, { own = false, active = false } = {}) {
  const view = {
    id: row.id,
    name: row.name,
    provider: row.provider,
    model: row.model,
    owner_username: ownerUsername,
    owner_user_id: userId(ownerUsername),
    own,
    active,
    shared: !own,
  };
  // A recipient must not learn whether a shared key exists, its hint, or its
  // endpoint. The server can still use the secret when resolving requests.
  if (own) {
    view.base_url = row.base_url;
    view.has_key = !!row.api_key;
    view.key_hint = row.api_key ? `${row.api_key.slice(0, 4)}…${row.api_key.slice(-4)}` : '';
  }
  return view;
}

function activeRow(username) {
  const id = userId(username);
  return id ? master.prepare('SELECT * FROM ai_active_profiles WHERE user_id = ?').get(id) : null;
}

export function accessibleProfile(username, ownerId, profileId) {
  const recipientId = userId(username);
  if (!recipientId) return null;
  const ownerUsername = usernameForId(ownerId);
  if (!ownerUsername) return null;
  if (Number(ownerId) !== Number(recipientId)) {
    const share = master
      .prepare(
        'SELECT 1 FROM ai_profile_shares WHERE profile_id = ? AND owner_user_id = ? AND recipient_user_id = ?',
      )
      .get(profileId, ownerId, recipientId);
    if (!share) return null;
  }
  const row = profileRow(ownerUsername, profileId);
  return row ? { row, ownerId: Number(ownerId), ownerUsername } : null;
}

export function listProfiles(username) {
  const ownId = userId(username);
  const legacy = ensureLegacyProfile(username);
  const active = activeRow(username);
  const ownRows = getUserDb(username)
    .prepare('SELECT * FROM ai_profiles ORDER BY created_at, name')
    .all();
  const profiles = ownRows.map((row) =>
    profileView(row, username, {
      own: true,
      active: active?.owner_user_id === ownId && active?.profile_id === row.id,
    }),
  );

  const shares = master
    .prepare(
      `SELECT s.profile_id, s.owner_user_id, u.username AS owner_username
       FROM ai_profile_shares s JOIN users u ON u.id = s.owner_user_id
       WHERE s.recipient_user_id = ? ORDER BY s.created_at DESC`,
    )
    .all(ownId);
  for (const share of shares) {
    const row = profileRow(share.owner_username, share.profile_id);
    if (row)
      profiles.push(
        profileView(row, share.owner_username, {
          own: false,
          active: active?.owner_user_id === share.owner_user_id && active?.profile_id === row.id,
        }),
      );
  }
  return {
    profiles,
    active_profile_id: active?.profile_id || legacy?.id || null,
    active_owner_user_id: active?.owner_user_id || (legacy ? ownId : null),
  };
}

export function setActiveProfile(username, ownerId, profileId) {
  const selected = accessibleProfile(username, ownerId, profileId);
  if (!selected) throw new Error('AI profile not found or not shared with this account');
  master
    .prepare(
      `INSERT INTO ai_active_profiles (user_id, owner_user_id, profile_id) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET owner_user_id = excluded.owner_user_id,
       profile_id = excluded.profile_id, updated_at = datetime('now')`,
    )
    .run(userId(username), Number(ownerId), profileId);
  return selected;
}

function normalizeInput(input, existing = null) {
  const provider = String(input.provider ?? existing?.provider ?? '').trim();
  const model = String(input.model ?? existing?.model ?? '').trim();
  if (!provider || !PROVIDERS[provider]) throw new Error('Unknown provider');
  if (!model) throw new Error('Model is required');
  const baseUrl = baseUrlFor(provider, input.base_url ?? existing?.base_url);
  const apiKey = input.api_key ? String(input.api_key).trim() : existing?.api_key || '';
  if (!PROVIDERS[provider].no_key && !apiKey)
    throw new Error('API key is required for this provider');
  return { provider, model, base_url: baseUrl, api_key: apiKey };
}

export function createProfile(username, input) {
  const name = String(input.name || '')
    .trim()
    .slice(0, 80);
  if (!name) throw new Error('Profile name is required');
  const values = normalizeInput(input);
  const legacy = ensureLegacyProfile(username);
  const id = crypto.randomUUID();
  getUserDb(username)
    .prepare(
      'INSERT INTO ai_profiles (id, name, provider, base_url, api_key, model) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(id, name, values.provider, values.base_url, values.api_key, values.model);
  if (!activeRow(username) && !legacy) setActiveProfile(username, userId(username), id);
  return profileRow(username, id);
}

export function updateProfile(username, profileId, input) {
  const ownerDb = getUserDb(username);
  const existing = ownerDb.prepare('SELECT * FROM ai_profiles WHERE id = ?').get(profileId);
  if (!existing) throw new Error('AI profile not found');
  const values = normalizeInput(input, existing);
  const name = String(input.name ?? existing.name)
    .trim()
    .slice(0, 80);
  if (!name) throw new Error('Profile name is required');
  ownerDb
    .prepare(
      "UPDATE ai_profiles SET name = ?, provider = ?, base_url = ?, api_key = ?, model = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .run(name, values.provider, values.base_url, values.api_key, values.model, profileId);
  return profileRow(username, profileId);
}

export function deleteProfile(username, profileId) {
  const ownerId = userId(username);
  const result = getUserDb(username).prepare('DELETE FROM ai_profiles WHERE id = ?').run(profileId);
  if (!result.changes) throw new Error('AI profile not found');
  master
    .prepare('DELETE FROM ai_profile_shares WHERE profile_id = ? AND owner_user_id = ?')
    .run(profileId, ownerId);
  master
    .prepare('DELETE FROM ai_active_profiles WHERE owner_user_id = ? AND profile_id = ?')
    .run(ownerId, profileId);
}

export function replaceShares(username, profileId, recipientUsernames) {
  const ownerId = userId(username);
  if (!ownerId || !profileRow(username, profileId)) throw new Error('AI profile not found');
  const names = [
    ...new Set(
      (Array.isArray(recipientUsernames) ? recipientUsernames : []).map((n) =>
        String(n).trim().toLowerCase(),
      ),
    ),
  ];
  const recipients = names.map((name) =>
    master.prepare('SELECT id, username FROM users WHERE username = ?').get(name),
  );
  if (recipients.some((row) => !row))
    throw new Error('One or more recipient accounts do not exist');
  if (recipients.some((row) => Number(row.id) === Number(ownerId)))
    throw new Error('A profile cannot be shared with its owner');
  master.exec('BEGIN');
  try {
    master
      .prepare('DELETE FROM ai_profile_shares WHERE profile_id = ? AND owner_user_id = ?')
      .run(profileId, ownerId);
    for (const recipient of recipients)
      master
        .prepare(
          'INSERT INTO ai_profile_shares (profile_id, owner_user_id, recipient_user_id) VALUES (?, ?, ?)',
        )
        .run(profileId, ownerId, recipient.id);
    master.exec('COMMIT');
  } catch (error) {
    try {
      master.exec('ROLLBACK');
    } catch {}
    throw error;
  }
  return listShares(username, profileId);
}

export function listShares(username, profileId) {
  const ownerId = userId(username);
  if (!ownerId || !profileRow(username, profileId)) throw new Error('AI profile not found');
  return master
    .prepare(
      `SELECT s.recipient_user_id, u.username, s.created_at
       FROM ai_profile_shares s JOIN users u ON u.id = s.recipient_user_id
       WHERE s.owner_user_id = ? AND s.profile_id = ? ORDER BY u.username`,
    )
    .all(ownerId, profileId);
}

export function currentProfileConfig(username = currentUsername()) {
  if (!username) throw new Error('AI profile context is unavailable');
  const legacy = ensureLegacyProfile(username);
  const active = activeRow(username);
  if (active) {
    const selected = accessibleProfile(username, active.owner_user_id, active.profile_id);
    if (selected)
      return {
        ...selected.row,
        profile_id: selected.row.id,
        owner_username: selected.ownerUsername,
        shared: selected.ownerUsername !== username,
      };
    master.prepare('DELETE FROM ai_active_profiles WHERE user_id = ?').run(userId(username));
  }
  if (legacy) return { ...legacy, profile_id: legacy.id, owner_username: username, shared: false };

  const baseUrl = String(process.env.AI_BASE_URL || '').replace(/\/+$/, '');
  if (!baseUrl) {
    const error = new Error(
      'AI is not configured. Create a profile in Settings or set AI_BASE_URL.',
    );
    error.status = 400;
    throw error;
  }
  return {
    provider: 'custom',
    base_url: baseUrl,
    api_key: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    profile_id: null,
    owner_username: null,
    shared: false,
  };
}

export function upsertCurrentProfile(username, input) {
  const active = activeRow(username);
  const ownId = userId(username);
  if (active && Number(active.owner_user_id) !== Number(ownId))
    throw new Error('The selected shared profile is read-only');
  const existing = active ? profileRow(username, active.profile_id) : ensureLegacyProfile(username);
  if (existing) return updateProfile(username, existing.id, input);
  return createProfile(username, { ...input, name: input.name || 'Default' });
}
