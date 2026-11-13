// Sets a new PIN for a kid who forgot hers. Her pets are not touched.
//
//   node tools/reset-pin.mjs <name> <new 4-digit PIN> --account <the Google account that owns the Firebase project>
//
// The account can also come from the ODD_EGG_ACCOUNT environment variable. It must already be signed in to the
// Firebase CLI on this Mac (npx firebase-tools login:add). Works by re-importing that one login with the new PIN,
// which Firebase allows for an existing account and keeps the same account id, so her cloud save stays hers.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const FIREBASE_TOOLS = 'firebase-tools@15.34.2';
const root = new URL('../', import.meta.url);
// Throws instead of exiting, so the temp folder below is always deleted.
class Stop extends Error {}
const stop = msg => { throw new Stop(msg); };
process.on('uncaughtException', e => { console.error(e instanceof Stop ? e.message : e); process.exit(1); });

const args = process.argv.slice(2), flag = args.indexOf('--account');
const account = flag >= 0 ? args.splice(flag, 2)[1] : process.env.ODD_EGG_ACCOUNT;
const [name, pin] = args;
if (!name || !pin) stop('Usage: node tools/reset-pin.mjs <name> <new 4-digit PIN> --account <google account>');
if (!account) stop('Say which Google account owns the Firebase project: add --account <email>, or set ODD_EGG_ACCOUNT.');

const html = readFileSync(new URL('index.html', root), 'utf8');
const E = new Function(html.match(/<script id="engine">([\s\S]*?)<\/script>/)[1] + '; return Engine;')();
const login = E.loginOf(name);
if (!login) stop(`"${name}" has no letters or numbers in it.`);
if (!E.pinOK(pin)) stop('The PIN must be exactly 4 numbers.');
const project = JSON.parse(readFileSync(new URL('.firebaserc', root), 'utf8')).projects.default;

function firebase(...cmd) {
  const r = spawnSync('npx', ['-y', FIREBASE_TOOLS, ...cmd, '--account', account, '--project', project, '--non-interactive'], { encoding: 'utf8' });
  if (r.status !== 0) {
    const why = `${r.stdout}\n${r.stderr}`.split('\n').map(l => l.trim()).filter(l => /error/i.test(l)).pop();
    stop(`Firebase said no: ${why || 'firebase-tools exited with ' + r.status}`);
  }
}

const dir = mkdtempSync(join(tmpdir(), 'odd-egg-pin-'));
try {
  // The export holds every login's password hash, so it lives in a private temp folder that is always deleted.
  firebase('auth:export', join(dir, 'users.json'), '--format=json');
  const email = E.loginEmail(login);
  const user = JSON.parse(readFileSync(join(dir, 'users.json'), 'utf8')).users.find(u => u.email === email);
  if (!user) stop(`Nobody logs in as "${login}" yet.`);

  const salt = randomBytes(16);
  const hash = createHash('sha256').update(Buffer.concat([Buffer.from(E.pinPassword(pin)), salt])).digest();
  const one = { localId: user.localId, email, emailVerified: false, passwordHash: hash.toString('base64'), salt: salt.toString('base64') };
  if (user.createdAt) one.createdAt = user.createdAt;
  if (user.lastSignedInAt) one.lastSignedInAt = user.lastSignedInAt;
  writeFileSync(join(dir, 'one.json'), JSON.stringify({ users: [one] }));
  firebase('auth:import', join(dir, 'one.json'), '--hash-algo=SHA256', '--rounds=1', '--hash-input-order=PASSWORD_FIRST');
  console.log(`PIN for ${name} is now set. Her pets are untouched.`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
