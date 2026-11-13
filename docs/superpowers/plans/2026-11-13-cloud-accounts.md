# Cloud Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layla and Rae log in with name + 4-digit PIN on any computer and get their whole save, kept in sync automatically.

**Architecture:** `index.html` stays one static page on GitHub Pages. Pure sync rules live in the engine script (unit-tested by `test-engine.mjs`). A new `<script id="cloud">` wraps Firebase Auth + Firestore Lite behind a small `Cloud` API. The game script keeps local storage as the on-computer copy and calls `Cloud` to pull and push.

**Tech Stack:** Vanilla JS. Firebase JS SDK 13.1.0 ES modules from `https://www.gstatic.com/firebasejs/13.1.0/` (`firebase-app.js`, `firebase-auth.js`, `firebase-firestore-lite.js`) via dynamic `import()`. firebase-tools 15.34.2 via `npx`.

**Spec:** `docs/superpowers/specs/2026-11-13-cloud-accounts-design.md`

## Global Constraints

- Every firebase-tools command: `npx -y firebase-tools@15.34.2 … --account ejspector@gmail.com --project <projectId>`. Never `login:use` and never change a global default.
- Firebase Spark (free) plan only. Firestore `(default)` database. No billing account.
- PIN: exactly 4 digits. Login: `E.loginOf(name)` (lowercase, a-z0-9 only, max 16).
- Email: `<login>@players.odd-egg-hatchery.invalid`. Password: `egg-<pin>-hatch`. If Task 1's probe shows Firebase rejects `.invalid`, use `<login>@players.<projectId>.firebaseapp.com` and change only `E.loginEmail`.
- Save text under 900 KB. One backup per day at `saves/{uid}/backups/{YYYY-MM-DD}`. Losing copies at `saves/{uid}/dropped/{ms}`.
- Upload within 2 seconds of a change. Sync never swaps the save while a round, boss or speed game is running.
- On a computer that already has a cloud player, picking her card needs no PIN (Eric, 2026-11-13).
- Kid-facing copy: short, plain, the game's playful voice. No "account", "sync", "server" or "error" words.
- Pushing to `main` deploys the live site. Commit only, then ask Eric before pushing.

## Review Focus

1. **Stale computer comes back.** A computer left open since yesterday syncs after the kid played elsewhere today. Expected: the newer cloud copy loads, and nothing newer is overwritten. Test: `syncPlan` "not dirty + cloud ahead → take", Task 2.
2. **Played offline on two computers.** Both copies changed. Expected: the higher-star copy wins, and the loser is saved to `dropped`. Tests: `syncPlan` conflict cases, Task 2; end-to-end run, Task 7.
3. **Restore from a paste.** A loaded code has fewer stars than the cloud. Expected: it becomes the cloud copy and stays there. Test: `syncPlan` with `force`, Task 2; end-to-end, Task 7.
4. **Name already taken by her own account** (old local "Layla" on a second computer). Expected: "Is this you?" → PIN → copies picker, never a second account. End-to-end, Task 7.
5. **Sync result arrives mid-round.** Expected: the save object isn't replaced during play. Guard in Task 4 (`applyCloud` skips when `inGame()`), checked in Task 7.

---

### Task 1: Firebase project, login, database, rules

**Files:**
- Create: `firebase.json`, `.firebaserc`, `firestore.rules`

**Produces:** `projectId`, and the web config object `{ apiKey, authDomain, projectId, appId }` for Task 3.

- [ ] **Step 1:** Write `firestore.rules`: under `/saves/{uid}`, read/create/update only if `request.auth.uid == uid`, `save is string`, `save.size() < 900000`, `rev is int`. Same for `/saves/{uid}/{sub}/{id}` with `sub in ['backups','dropped']` (no `rev` needed). No delete, no list across users.
- [ ] **Step 2:** Write `firebase.json` with `{"firestore":{"rules":"firestore.rules"},"auth":{"providers":{"emailPassword":true}}}`.
- [ ] **Step 3:** `projects:create odd-egg-hatchery --display-name "Odd Egg Hatchery"`. If the id is taken, use `odd-egg-hatchery-<4 random lowercase letters/digits>`. If it fails on Firebase terms not accepted, stop and ask Eric to accept them at console.firebase.google.com. Write `.firebaserc` with the id.
- [ ] **Step 4:** `firestore:databases:create "(default)" --location=nam5`.
- [ ] **Step 5:** `deploy --only auth,firestore:rules`. Expected: "Deploy complete". If `auth` deploy is unsupported, give Eric the console click: Authentication → Get started → Email/Password → Enable.
- [ ] **Step 6:** `apps:create WEB "Odd Egg Hatchery"`, then `apps:sdkconfig WEB <appId>`. Keep the config.
- [ ] **Step 7: Probe with a throwaway account** using the REST API (`identitytoolkit.googleapis.com/v1/accounts:signUp?key=<apiKey>`): sign up `probe1@players.odd-egg-hatchery.invalid`. Expected: an `idToken`. A second sign-up with the same email → `EMAIL_EXISTS`.
- [ ] **Step 8: Probe the PIN reset path:** write a one-user import file for `probe1` (same `localId`; `passwordHash` = base64 sha256(newPassword + salt); `salt` = base64 of 16 random bytes). Run `auth:import <file> --hash-algo=SHA256 --rounds=1 --hash-input-order=PASSWORD_FIRST`. Then REST `signInWithPassword` with the new password. Expected: success. If the import refuses an existing uid, record that, and Task 6 uses `auth:export` + delete-and-reimport with the same `localId`, probed the same way.
- [ ] **Step 9:** Delete the probe user: REST `accounts:delete` with its idToken.

### Task 2: Engine helpers (pure, tested)

**Files:**
- Modify: `index.html` engine script (`<script id="engine">`, export list at its end)
- Test: `test-engine.mjs`

**Produces:**
- `loginOf(name: string) → string` (`'  Layla S! '` → `'laylas'`, emoji-only → `''`, cut to 16)
- `loginEmail(login) → string`, `pinPassword(pin) → string`, `pinOK(pin) → boolean` (`/^\d{4}$/`)
- `progressOf(save) → { stars, q }`, where `q` = sum of `save.days[*].q`
- `localWins(local, cloud) → boolean`: more stars wins; a tie goes to more `q`; a full tie → `false`
- `syncPlan(link: {rev, dirty, force}, doc: {rev, save}|null, local) → { act: 'none'|'push'|'take', drop?: 'local'|'cloud', force?: true }`, where `doc.save` is the parsed save object

`syncPlan` table (the tests are this table):

| link | doc | → |
|---|---|---|
| any | null | `push` |
| `force` | any | `push, force` |
| `rev == doc.rev`, not dirty | — | `none` |
| `rev == doc.rev`, dirty | — | `push` |
| `rev < doc.rev`, not dirty | — | `take` |
| `rev < doc.rev`, dirty, `localWins` | — | `push, force, drop:'cloud'` |
| `rev < doc.rev`, dirty, not `localWins` | — | `take, drop:'local'` |
| `rev > doc.rev` | — | `push, force` |

- [ ] **Step 1:** Add tests `cloud: loginOf`, `cloud: pin + email`, `cloud: localWins`, `cloud: syncPlan` (one assertion per table row) to `test-engine.mjs`.
- [ ] **Step 2:** `node test-engine.mjs` → FAIL (`E.loginOf is not a function`).
- [ ] **Step 3:** Implement and export the helpers above.
- [ ] **Step 4:** `node test-engine.mjs` → all `ok`, including the existing tests.

### Task 3: Cloud wrapper

**Files:**
- Modify: `index.html`: new `<script id="cloud">` between the engine and game scripts.

**Consumes:** Task 1 config. Task 2 `loginEmail`, `pinPassword`.
**Produces:** global `Cloud`, where every method returns a Promise. Failures reject with `{ code }`, where `code` ∈ `'offline'|'wrong'|'taken'|'throttled'|'nosession'|'other'`:
- `Cloud.signUp(login, pin) → { uid }`
- `Cloud.signIn(login, pin) → { uid }`
- `Cloud.hasSession(login) → boolean`
- `Cloud.pull(login) → { rev, save: string, stars } | null`
- `Cloud.push(login, saveText, baseRev, force) → { rev } | { conflict: { rev, save: string } }`. A Firestore Lite transaction: read the doc and `backups/<today>`. Conflict if `!force && doc.rev !== baseRev`. Otherwise write the doc with `rev = (doc?.rev || 0) + 1`, `login`, `name`, `stars`, `updated: serverTimestamp()`, plus today's backup if it's missing.
- `Cloud.keep(login, saveText) → void`: writes `dropped/<Date.now()>`
- `Cloud.forget(login) → void`: signs that login out on this computer

One named Firebase app per login: `initializeApp(config, 'p-' + login)`. Auth errors map as follows: `auth/invalid-credential`, `auth/wrong-password` and `auth/user-not-found` → `wrong`; `auth/email-already-in-use` → `taken`; `auth/too-many-requests` → `throttled`; `auth/network-request-failed` and a failed `import()` → `offline`.

- [ ] **Step 1:** Write the script. The SDK loads on first use (memoized `load()`).
- [ ] **Step 2:** Serve locally (`python3 -m http.server 8765` via `.claude/launch.json`), then run in the page console: `signUp('zztest1','1234')` → push → pull → `rev 1`. Then `signIn` with the wrong PIN → `wrong`. Then pull `zztest2`'s doc with zztest1's session → permission denied. Expected as listed. These accounts are deleted in Task 7.

### Task 4: Game sync loop

**Files:**
- Modify: `index.html` game script: `loadRoot`, `persist`, startup, `pick`, `visibilitychange`, `online`

**Consumes:** Tasks 2 and 3.
**Produces:**
- `root.cloud: { [playerId]: { login, rev, dirty, force } }`. Saved in local storage, never in the backup code. Links to missing players are dropped on load.
- `ui.cloud: { [playerId]: ''|'busy'|'offline'|'pin' }` (status for badges; not saved)
- `writeLocal()`: today's `persist()` body. `persist()` = mark the current player's link dirty, then `writeLocal()`, then `syncSoon()`.
- `syncSoon()`: 2-second debounce, then `syncPlayer(id)`.
- `syncPlayer(id) → Promise`: `Cloud.pull`, then parse `doc.save` with `E.repair(JSON.parse(…))`, then `E.syncPlan`, then act. `take` → `applyCloud(id, text)`. `push` → `Cloud.push`; on `{conflict}`, run the plan again with that doc. `drop` → `Cloud.keep` the losing text first. `nosession` → status `'pin'`. `offline` → status `'offline'`.
- `applyCloud(id, text)`: `E.repair(JSON.parse(text))`, swap it into `root.players`, set `save` if current, `writeLocal()`, `render()` unless `inGame()`. If `inGame()`, skip; the next sync handles it.

- [ ] **Step 1:** Implement. Sync all linked players on start, on `pick`, on `visibilitychange` → visible (skipped while `inGame()`), and on `online`. Push on `pagehide` if dirty (best effort).
- [ ] **Step 2:** `node test-engine.mjs` passes. The page loads with no console errors with zero players, and with the existing local-only players (no cloud calls, SDK not loaded: check the Network tab has no gstatic request).

### Task 5: Screens

**Files:**
- Modify: `index.html` game script: `vWho`, `vWelcome`, `vHome`, `vGrownups`, `ACTS`, the submit handler (route by `data-form`), `render` views, a little CSS

**Consumes:** Task 4.
**Produces:** screens `login` (`vLogin`), `cloud` (`vCloud`), `choose` (`vChoose`), with `ui.cloudForm = { step, login, pin, note }` holding their state.

- [ ] **Step 1: Who + welcome.** Add a "🔑 I already have a player" card and a welcome-screen link to it. Show ☁️ on linked cards and ⚠️ on `offline`.
- [ ] **Step 2: Login screen.** Fields: name, PIN (`type=password inputmode=numeric maxlength=4`). Submit: `signIn` → `pull`. Then:
  - a linked player with this login is already here → pick her;
  - an unlinked local player has the same `loginOf(name)` → `choose`;
  - otherwise add her from the cloud copy (4-player limit → message);
  - no cloud copy → "We couldn't find pets for that name yet."
  - Errors: `wrong` → "That name and PIN don't match."; `throttled` → "Too many tries. Wait a few minutes."; `offline` → "Can't reach the internet."
- [ ] **Step 3: Home + cloud setup.** Unlinked players get a "☁️ Play on any computer" button. Linked players get a tiny "☁️ On other computers, log in as **login**", or a "Type your PIN to keep saving" button when the status is `pin`. The `vCloud` form has name (prefilled), PIN and PIN again, then `signUp` → link → push. `taken` → "Someone already has the name X. Is it you?" Yes → PIN → `signIn` → `choose`. No → pick another name.
- [ ] **Step 4: Choose screen.** Two cards, "This computer" and "Cloud", each with stars and pets grown, and a "Keep this one" button. Keep local → `Cloud.keep(cloud copy)`, set `force`, push. Keep cloud → `Cloud.keep(local copy)`, then `applyCloud`.
- [ ] **Step 5: Grown-ups.** For a linked player, "Erase this player" becomes "Remove from this computer (still saved in the cloud)": `Cloud.forget`, then splice. The code export leaves out `root.cloud`. `loadcode` accepts the base64 code or raw save JSON (an object with `subject` and `facts`). Raw JSON replaces the current player. Any loaded player that matches a linked id gets `force: true` and syncs.
- [ ] **Step 6:** `node test-engine.mjs` passes. Click through every new screen once in the browser pane. No console errors.

### Task 6: Forgotten-PIN tool

**Files:**
- Create: `tools/reset-pin.mjs`

- [ ] **Step 1:** `node tools/reset-pin.mjs <name> <pin>` loads the engine from `index.html` (the same regex as `test-engine.mjs`) for `loginOf`, `loginEmail`, `pinPassword` and `pinOK`. It finds the uid by `auth:export` to a temp file, then sets the password by the method Task 1 Step 8 proved. It prints only "PIN for <name> is now set." or a plain reason. The temp files are deleted on exit. The project id is read from `.firebaserc`, and the account comes from `--account` or the `ODD_EGG_ACCOUNT` env var, else the tool stops and says so.
- [ ] **Step 2:** `node --check tools/reset-pin.mjs`. Run it on the Task 7 test account `zztest1`, then log in on the page with the new PIN → works.

### Task 7: End-to-end in two "computers", then clean up

Two "computers" = `http://localhost:8765` and `http://127.0.0.1:8765` (separate storage), in the built-in browser.

- [ ] **Step 1:** On A, make "Zzlayla", answer 5 questions, then ☁️ → PIN 2468. On B, use "I already have a player" → Zzlayla + 2468 → same stars and same day stats.
- [ ] **Step 2:** On B, play 1 round. Switch to A's tab (visibility) → A shows B's stars without a reload.
- [ ] **Step 3: Conflict.** On each tab, fake offline by replacing `Cloud.pull` and `Cloud.push` with functions that reject `{code:'offline'}`. Play a round on A and two on B, then put the real methods back and sync both → B's copy (more stars) is on both. A's copy is in `dropped/`: check with a REST list as zztest's user (`saves/<uid>/dropped`).
- [ ] **Step 4: Restore.** Load an older pasted save on A → the cloud shows it, and B takes it on focus.
- [ ] **Step 5: Name taken.** On B, delete local, make a new local "Zzlayla", then ☁️ → "Is it you?" → PIN → choose screen. No second account (REST lookup of the email returns one user).
- [ ] **Step 6: Clean up.** Delete the test users (REST `accounts:delete` with each user's idToken) and their docs (`firestore:delete saves/<uid> -r --force`, with the explicit `--account` and `--project`). Clear both origins' local storage. Expected: `auth:export` shows 0 users.

### Task 8: Commit

- [ ] **Step 1:** `node test-engine.mjs` → all ok (read the exit code).
- [ ] **Step 2:** In a separate call: `git add` the files from Tasks 1-6 + spec + plan, and commit `feat: log in with name + PIN to play on any computer`.
- [ ] **Step 3:** Ask Eric before `git push` (push = live deploy).
