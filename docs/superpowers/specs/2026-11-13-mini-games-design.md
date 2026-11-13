# Pet Park: mini games she earns by doing well

Date: 2026-11-13. Status: approved by Eric, 2026-11-13.

## Why

Eric wants fun mini games that aren't math, unlocked when she has done well. They are a treat that makes a good round feel even better, so she comes back to the math.

Success: after a great round she sees "+1 🎟️", says "yes!", plays a one-minute game with her own odd pets, and goes back for another round to earn the next ticket.

## Goals

- Three original mini games starring her own pets, in their outfits: **Egg Catch**, **Pop-up Pets** and **Pet Memory**.
- She earns 🎟️ tickets by doing well. 1 ticket = 1 game.
- Games unlock one at a time as she levels up.
- Every player gets Pet Park. Each player earns and spends her own tickets.

## Non-goals

- More than three games in this first version.
- Seeds or stars from the mini games (see Rewards below).
- Two-player or head-to-head games.
- Changes to the learning engine or how a round plays.

## Anti-goals (a failure even if it "works")

- **The games crowd out the math.** No way to play without earning a ticket first, and no ticket without real math work.
- **Losing a ticket by accident** (for example, a mis-click on Home in the first second).
- **A recreation of a real game** (its name, look or levels). These are original games in common genres.
- **Frustration.** No game ends in "you lose": each is a timer or a puzzle you always finish.

## Constraints

- Still one static file (`index.html`) on GitHub Pages. No new libraries. Pushing to `main` updates the live site, so nothing is pushed without Eric's OK.
- She plays on a computer with a keyboard (from the Eureka spec). Every game works with keys alone, and with a mouse or trackpad.
- Two other sessions are planning edits to `index.html` (cloud accounts, Eureka grade 5). The shared folder is already switched to `feat/cloud-accounts`. This work happens in its own git worktree on branch `mini-games`, cut from `main`, and is merged to `main` only when Eric says so. If cloud accounts merge first, the later merge reconciles `repair()` and the save shape.
- The new save fields sit on the player save. Once cloud accounts ship, they sync along with everything else.
- In the rare cloud conflict, tickets and bests follow whichever copy wins, exactly as seeds and shop items do today. The losing copy is still kept in the cloud. Accepted. (Claude's call)

## Approaches

| Question | Options | Picked |
|---|---|---|
| How she earns games | Tickets + unlocks · tickets only · unlock forever | **Tickets + unlocks** (Eric, 2026-11-13) |
| Which games first | Egg Catch · Pet Memory · Pop-up Pets · Egg Stack | **Egg Catch, Pet Memory, Pop-up Pets** (Eric, 2026-11-13) |
| How to build them | SVG pets moved each frame inside `index.html` · `<canvas>` · a game library from a CDN | **SVG inside `index.html`** (Claude's call: reuses `creatureSVG` with outfits as is. Canvas would need the pets converted to images, with no gain at ≤15 sprites. A library is a big download against the one-file design.) |

## Design

### Earning tickets

She gets **1 🎟️** for each of these:

| Event | Rule | Where it's checked |
|---|---|---|
| A great round | at least 75% right: 9 of a normal 12-question round. This is the same rule (`ok >= asked * 0.75`) the game already uses to say "Great hatching!". A round cut short by the last egg growing up counts too. | `finishRound` |
| Beating a boss egg | the win itself | `bossAnswer` |
| All 3 daily quests done | once a day, when the existing +25 🌱 bonus pays | `questEvent` |

- No daily cap and no limit on saved tickets (Claude's call: every ticket already costs real math, and a cap would punish a kid for doing well).
- The three sources stack. A great round that also finishes the third quest earns 2, and the screen says "+2 🎟️".
- Mini games never earn tickets and never count toward quests.

### Unlocks

| Game | Opens at | Why that order |
|---|---|---|
| 🥚 Egg Catch | level 2 | the most exciting game, earned almost right away |
| 🐹 Pop-up Pets | level 4 | |
| 🃏 Pet Memory | level 6 | needs 6 different pets, which she will have by then |

The level-up card lists a newly opened game under "Unlocked:" (as it does today for the speed nest). Levels are Claude's call; Eric can change them.

### On the screens (text sketch)

```
Home: header chips   ⭐ Level 5   🌱 120 seeds   🎟️ 2   🔥 3 days
Home: bottom row     [📖 Pet book] [🛍️ Shop] [🎪 Pet Park 🎟️ 2] [👥 Switch player] [Grown-ups]

Round done!  Great hatching! You got 10 of 12 right.
             🎟️ +1 ticket for Pet Park!
             [Another round ▶] [🎪 Pet Park] [Home]

🎪 Pet Park                                        🎟️ 2
 [🥚 Egg Catch     best 23     Play ▶ 1 🎟️]
 [🐹 Pop-up Pets   best 31     Play ▶ 1 🎟️]
 [🔒 Pet Memory    opens at level 6]
 How to earn a 🎟️: 9 of 12 right in a round · beat a boss egg · finish all 3 quests
```

- The existing chips stay, and 🎟️ is added next to them.
- The Pet Park button is always on Home, even before any game opens, so she can see what's coming.
- With 0 tickets, the Play buttons are disabled and the page says how to earn one.
- The boss-win screen and the all-quests line also show "+1 🎟️".

### The three games

All three share a top bar: `[← Quit]  Game name  Score  ⏱ time left`.
- The ticket is spent, and the save written, when she presses Start.
- If the tab closes mid-game, that ticket is gone. (Claude's call: refunding on reload would let her reload to replay for free. Closing a tab mid-game is rare.)
- Quitting takes two presses: the first changes the button to "Tap again to quit", using the existing `ui.arm` pattern. That stops a ticket being lost to a mis-click.
- The mic is off in Pet Park. The games get their own key handling, separate from answer typing.
- Each game opens on a "How to play" card with a Start button (Enter works too), and ends on a results card: score, "NEW BEST!" when it is one, and [Pet Park] [Home].

**🥚 Egg Catch** (60 seconds)
- Her pet stands at the bottom of a wide play area. It's the same pet her home screen shows, with its outfit.
- Eggs fall from the top. Catch one for +1. A rare golden egg is worth +3.
- A green stinky egg with flies costs 3 points if caught (the score never goes below 0), and the pet makes a "yuck" face.
- Missed eggs cost nothing. Eggs fall faster and more often as the minute goes on.
- Controls: hold ← → (or A D), or move the mouse over the play area.

**🐹 Pop-up Pets** (60 seconds)
- A 3 × 3 field of nests, each labeled 1 to 9 in keyboard order (1 2 3 on top).
- Her hatched pets pop up for a moment. Bonk one for +1, by clicking it or pressing its number.
- A rare pet in a crown is worth +3. The grumpy purple boss egg sometimes pops up too: bonking it costs 2.
- Pets pop up faster as the minute goes on.

**🃏 Pet Memory** (no timer)
- 12 face-down cards hide 6 pairs of her pets. Flip two at a time. A match stays face up. A miss flips back after about a second.
- Score = moves. The best is the **fewest** moves.
- Controls: click, or the arrow keys plus Enter.

**Which pets appear** (one helper, Claude's call):
- Pets she has hatched (stage 3 or 4) in her current subject come first, then her other subjects. Each wears the outfit saved for it, including outfits stored in `save.tracks`.
- If she has too few pets, warming and cracking eggs (stages 1 and 2) fill the gaps. No egg looks like another one in the same game (each has a different color and pattern).
- A game never refuses to start.
- Egg Catch's catcher is her most grown-up pet: a stage-4 pet in its outfit if she has one, otherwise a hatchling in its shell.

### Rewards

The game itself is the reward. It gives no seeds and no stars, only a personal best per game. (Claude's call: stars and levels mean "learned something", and seeds buy outfits. If the games paid either, she could earn them without math.)

### Saved data

Two new fields on the player save, shared across subjects like seeds (they are not part of the per-subject data):

```
tickets: 2,
arcade: { best: { catch: 23, pop: 31, memory: 14 } }
```

- `repair()` fills these in for older saves (`tickets: 0`, empty bests) and clamps bad values.
- The day-by-day log gains `tix` (tickets earned) and `games` (games played).
- The grown-ups "Day by day" table gains a 🎟️ column ("2 earned · 1 played"), so Eric can see game time next to math time. Days from before this change show a blank cell.

### Engine additions (testable, in `<script id="engine">`)

- `GAMES`: the game list with id, name and unlock level.
- `gamesOpen(save)`: which games are open at her level.
- `startGame(save, id, now)`: spends a ticket. Returns false if she has no ticket or the game is locked.
- `gameFinish(save, id, score, now)`: saves the best (lower is better for memory) and reports whether it's a new best.
- Ticket awards inside `finishRound`, `bossAnswer` and `questEvent`, reported on the round, the boss result and the quest event.

### Testing

- `node test-engine.mjs`: the existing 28 tests still pass. New tests cover:
  - a great round (9/12 earns a ticket, 8/12 does not)
  - a boss win earns one
  - the quest bonus earns one, and only once a day
  - `startGame` spends a ticket and refuses when there are none or the game is locked
  - bests are saved (memory: lower is better)
  - an old save without the new fields loads with 0 tickets
  - tickets are shared when she switches subjects
- In the browser, each game is played end to end with a test save:
  - keyboard only, then mouse only
  - the quit two-step works
  - a ticket is spent exactly once per game
  - a new best shows
  - no console errors

## Left to the builder

- Exact copy for buttons and messages (kid-readable, in the game's voice).
- Spawn rates, fall speeds and pop-up timing, tuned so an 8 to 11 year old scores roughly 15 to 30 in a minute.
- Play-area sizes, animations and sounds (reusing `sfx()`).
- Pausing the timer while the tab is hidden.
