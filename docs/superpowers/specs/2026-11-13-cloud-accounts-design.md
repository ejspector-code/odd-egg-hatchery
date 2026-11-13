# Cloud accounts: play on any computer

Date: 2026-11-13. Status: approved by Eric, 2026-11-13.

## Why

Layla and Rae play on more than one computer. Today every save lives in one browser's local storage, so progress on one computer is invisible on another. The only bridge is the copy-and-paste backup code on the grown-ups page, which kids won't use.

Success: Layla sits at any computer, opens the game, types "Layla" and her PIN, and sees her own pets, seeds, stars, level, shop items and stats. When she plays, the cloud copy keeps up without anyone pressing Save.

## Goals

- Each kid has her own account: name + a 4-digit PIN she picks.
- The whole player save syncs: every subject, facts, pets, seeds, stars, level, outfits, quests, boss eggs, day-by-day stats.
- Existing progress on today's computers moves into the account, not lost.
- The game still works offline and still opens with no login for a brand new player.

## Non-goals

- Email, passwords, or grown-up accounts.
- Two kids sharing one account, or a family dashboard.
- Live play on two computers at the same moment.
- Changing the learning engine or how the game plays.

## Anti-goals (a failure even if it "works")

- A kid loses pets because of syncing: an old computer overwrites newer progress.
- Logging in feels like homework: more than name + PIN, or it nags every visit.
- A sister can open the other sister's save on a computer that has never seen it. On a computer both girls already use, tapping a card needs no PIN, same as today (Eric, 2026-11-13).

## Constraints

- The page stays one static file on GitHub Pages (`ejspector-code.github.io/odd-egg-hatchery`). Pushing to `main` updates the live site.
- Free, no credit card: Firebase Spark plan (Auth + Firestore `(default)` database).
- Eric's gcloud is signed in to a work account. Firebase setup uses his personal Google account through `firebase login`, not gcloud.

## Approaches

| Approach | Trade-off | Picked? |
|---|---|---|
| **Firebase** Auth + Firestore | Free, login and wrong-guess throttling built in, no server code to maintain. Adds the Firebase SDK from Google's CDN. | **Yes** (Eric, 2026-11-13) |
| Cloudflare Worker + database | Free, full control, but I'd write and maintain the login and storage server, and Eric needs a new account. | No |
| Supabase | Free, but free projects pause after 7 days with no play and need a manual wake-up. | No |

Login style, picked by Eric: **name + 4-digit PIN** (over a family password, or tapping 3 secret pictures).

## Design

### Accounts

- A Firebase email/password account per kid. The kid never sees the email or password:
  - email = `<login>@players.odd-egg-hatchery.invalid`, where `login` = the name lowercased with only a-z and 0-9 kept ("Layla" → `layla`).
  - password = the PIN wrapped in a fixed string, because Firebase needs at least 6 characters.
- Names are unique across the game. When "☁️ Play on any computer" finds "layla" taken, it first asks "Is this you? Type your PIN." The right PIN signs her in and goes to the both-copies picker (see Moving today's progress in), so a second computer can't split her progress into two accounts. Only if she says it isn't her does she pick another login, like "LaylaS". The name on her card stays "Layla", and her home screen shows "Log in as LaylaS" so she can find it. (Builder's call.)
- Firebase throttles repeated wrong PINs. A 4-digit PIN stops a sister or a classmate, not a determined attacker. Accepted for a kids' game, with the daily backup below as the safety net.

### Stored data

Firestore document `saves/{uid}`:

```
{ login: "layla", name: "Layla", save: "<player save as JSON text>", rev: 17, stars: 412, updated: <server time> }
```

Plus one backup copy per day at `saves/{uid}/backups/{YYYY-MM-DD}`, written on the first sync of each day.

Security rules: a signed-in kid can read and write only her own `saves/{uid}` and its backups. Nobody can list other saves. The save text must be under 900 KB.

### On the screens (text sketch)

```
Who is hatching today?
 [Layla ☁️] [Rae ☁️] [+ New player] [🔑 I already have a player]

🔑 I already have a player
 Name [ Layla ]   Secret PIN [ • • • • ]   [ Let's go ▶ ]

Home screen of a player not yet in the cloud
 [☁️ Play on any computer]  → "Pick a secret 4-digit PIN" → "Type it again"
 → "Done! On another computer, tap 'I already have a player'."
```

- New players get the same "☁️ Play on any computer" button on their home screen. Never required.
- ☁️ on a player card means saved to the cloud. A small ⚠️ means "not saved to the cloud yet" (offline); it clears on its own.
- Grown-ups page: "Erase this player" becomes "Remove from this computer" for cloud players. The cloud copy stays. Deleting a cloud account is grown-up-only, in the Firebase console.

### Syncing

- Local storage stays the on-computer copy, so the game runs offline and opens fast.
- After any change (`persist()`), the current player's save uploads within 2 seconds, and again when the tab is hidden or closed.
- Before play, the game downloads the newest cloud copy: when the page opens, when a player is picked, and when the tab comes back into view.
- Each upload carries the revision number it started from. If the cloud moved on in the meantime (she played somewhere else), the game keeps whichever copy has more stars (stars only ever go up). The losing copy is never just thrown away: it is uploaded to `saves/{uid}/dropped/{time}` first, so the cloud always has it. Conflicts can only be noticed online, so a copy played offline reaches the cloud this way too. (Builder's call.)
- Undoing a bad pick (builder's call): on the grown-ups page, "Load pasted code" accepts either the existing backup code or a save copied out of the Firebase console (a daily backup or a dropped copy). For a cloud player, a loaded save is a forced restore: it uploads as the new cloud copy even with fewer stars, and the stars rule doesn't apply to it.
- Two kids on one computer stay signed in together: each kid gets her own Firebase app instance, so each keeps her own login.

### Moving today's progress in

- On the computer where she already plays, Layla taps "☁️ Play on any computer" and picks a PIN. Her current pets upload.
- If she logs in on a computer that already has a non-cloud "Layla", she sees both ("This computer: 40 stars. Cloud: 412 stars.") and picks one. The other copy is removed from that computer.

### Forgotten PIN

`tools/reset-pin.mjs`: Eric runs `node tools/reset-pin.mjs layla 1234` on his Mac, and it sets a new PIN using his Firebase login. Pets are untouched.

### Firebase setup (one time)

1. Eric runs `npx firebase-tools login` once and picks his personal Google account (~2 minutes).
2. Claude creates the project, turns on email/password login, creates the Firestore database, registers the web app, and deploys the security rules, all from the command line. If a step won't run from the command line, Eric gets one console click with exact directions.
3. Repo gains `firebase.json`, `.firebaserc` and `firestore.rules`. The web config in `index.html` is public by design; the security rules protect the data.

### Testing

- Engine tests (`node test-engine.mjs`) still pass.
- New pure helpers (login names, picking which copy wins) get tests in `test-engine.mjs`.
- An end-to-end run against the real project with throwaway accounts, in two separate browsers standing in for two computers: make a player → cloud → log in on the other browser → play → see it on the first. Throwaway accounts are deleted afterwards.

## Left to the builder

- Exact copy for buttons and messages (kid-readable, matching the game's voice).
- Upload timing details, error messages, and how offline retries are scheduled.
- Firebase JS SDK: pinned to 13.1.0 from `www.gstatic.com`, loaded only when a cloud feature is needed or a cloud player is on this computer.
