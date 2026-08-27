// One-shot admin account creation for fresh installs.
// Usage (as the service user, with DATA_DIR set):
//   BP_USER=NAME BP_PW=PASSWORD node server/cli-add-user.mjs
// Refuses to run once any account exists (first-run only, becomes admin).
import { hasAnyUser, als, getUserDb } from './db.js';
import { createUser } from './auth.js';
import { setSetting } from './db.js';

const name = process.env.BP_USER ?? '';
const pw = process.env.BP_PW ?? '';
if (!name || !pw) {
  console.error('BP_USER and BP_PW environment variables are required');
  process.exit(1);
}
if (hasAnyUser()) {
  console.error('An account already exists — refusing to create another via CLI.');
  process.exit(1);
}
try {
  await createUser(name, pw, 'admin');
  als.run(getUserDb(name), () => setSetting('currency', 'EUR'));
  console.log(`Admin account "${name}" created.`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
