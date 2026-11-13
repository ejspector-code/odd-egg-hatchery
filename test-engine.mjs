// Run with: node test-engine.mjs
// Pulls the learning engine out of index.html and checks it with pretend learners.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const src = html.match(/<script id="engine">([\s\S]*?)<\/script>/)[1];
const E = new Function(src + '; return Engine;')();

const HOUR = 3600e3;
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ' + name); };
const seeded = seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

test('fact counts and unique ids', () => {
  assert.equal(E.SUBJECTS.times.facts.length, 55);
  assert.equal(E.SUBJECTS.plusminus.facts.length, 110);
  for (const k of ['spell3', 'spell5']) {
    const words = E.SUBJECTS[k].facts.map(f => f.word);
    assert.equal(words.length, 60, k);
    assert.equal(new Set(words).size, 60, k + ' has a repeated word');
    for (const w of words) assert.match(w, /^[a-z]{3,16}$/, w);
    assert.equal(E.SUBJECTS[k].groups.length, 6);
  }
  for (const k of Object.keys(E.SUBJECTS)) {
    const ids = E.SUBJECTS[k].facts.map(f => f.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const g of E.SUBJECTS[k].groups) assert.equal(g.ids.length, 10, g.key);
  }
  assert.equal(E.SUBJECTS.times.groups.length, 10);
  assert.equal(E.SUBJECTS.plusminus.groups.length, 20);
  assert.equal(new Set(E.NAMES).size, 55);
});

test('easy facts come before hard ones', () => {
  const t = E.SUBJECTS.times.facts.map(f => f.id);
  assert.equal(t[0], '1x1');
  assert.ok(t.indexOf('2x5') < t.indexOf('6x7'));
  assert.deepEqual(t.slice(-3), ['7x7', '7x8', '8x8']);
  const p = E.SUBJECTS.plusminus.facts.map(f => f.id);
  assert.ok(p.indexOf('1+1') < p.indexOf('1-1'), 'adding tier before its taking-away tier');
  assert.ok(p.indexOf('2+3') < p.indexOf('7+9'));
  assert.ok(p.indexOf('5+5') < p.indexOf('6+8'));
});

test('questions are posed with the right answers', () => {
  const T = E.SUBJECTS.times.byId, P = E.SUBJECTS.plusminus.byId;
  assert.deepEqual(E.pose(T['7x8'], false), { x: 7, op: '×', y: 8, ans: 56 });
  assert.deepEqual(E.pose(T['7x8'], true), { x: 8, op: '×', y: 7, ans: 56 });
  assert.deepEqual(E.pose(P['7+8'], true), { x: 8, op: '+', y: 7, ans: 15 });
  assert.deepEqual(E.pose(P['7-8'], false), { x: 15, op: '−', y: 7, ans: 8 });
  assert.deepEqual(E.pose(P['7-8'], true), { x: 15, op: '−', y: 8, ans: 7 });
  for (const k of ['times', 'plusminus']) for (const f of E.SUBJECTS[k].facts) for (const flip of [false, true]) {
    const q = E.pose(f, flip);
    const real = q.op === '×' ? q.x * q.y : q.op === '+' ? q.x + q.y : q.x - q.y;
    assert.equal(q.ans, real, f.id);
    assert.ok(q.ans >= 1 && q.ans <= 100);
  }
});

test('spoken answers turn into numbers', () => {
  const cases = { 'fifty six': 56, 'fifty-six': 56, '56': 56, 'seven times eight is fifty six': 56, '7 x 8 = 56': 56, '7x8=56': 56,
    'forty two.': 42, 'a hundred': 100, 'one hundred': 100, 'twelve': 12, 'ate': 8, 'for': 4, 'to': 2, 'um': null, '': null,
    'is it sixteen': 16, 'nine': 9, 'I think 81': 81, 'twenty': 20 };
  for (const [said, want] of Object.entries(cases)) assert.equal(E.parseSpoken(said), want, JSON.stringify(said));
});

// A pretend learner plays `roundsPerDay` rounds a day. `knows(id, seenBefore)` says if she gets it right;
// `ms` is how long she takes. Returns how many days it took to memorise everything.
function simulate(subject, { knows, ms = 2000, roundsPerDay = 1, maxDays = 400, seed = 1 }) {
  const rnd = seeded(seed);
  let now = new Date(2026, 0, 5, 16, 0, 0).getTime();
  const save = E.newSave(now, subject, 'Test');
  const taught = new Set(), stageDay = {};
  for (let day = 1; day <= maxDays; day++) {
    for (let r = 0; r < roundsPerDay; r++) {
      const round = E.startRound();
      let prev = null, q;
      while ((q = E.nextQuestion(save, round, now, rnd))) {
        assert.ok(round.learners.length <= E.MAX_LEARNERS + 2, 'new facts per round stays small');
        if (prev === q.id) assert.fail('same fact asked twice in a row: ' + q.id);
        prev = q.id;
        const right = knows(q.id, taught.has(q.id));
        const res = E.answer(save, round, q, right ? q.ans : q.ans + 1, typeof ms === 'function' ? ms(q) : ms, now);
        if (!right) taught.add(q.id);
        assert.equal(res.correct, right);
        // a fact may never go from cold egg to memorised inside one day
        const key = E.dateKey(now);
        if (res.from === 0) stageDay[q.id] = key;
        if (res.to === 4 && res.from !== 4) assert.notEqual(stageDay[q.id], key, q.id + ' memorised the day it was first met');
        now += 6000;
      }
      assert.ok(round.asked <= E.ROUND_LEN);
      E.finishRound(save, round, now);
    }
    if (save.done) return { days: day, save };
    now = E.dayStart(now, 1) + 16 * HOUR;
  }
  return { days: Infinity, save };
}

for (const subject of Object.keys(E.SUBJECTS)) {
  const total = E.SUBJECTS[subject].facts.length;

  test(`${subject}: a child who already knows everything finishes fast`, () => {
    const { days, save } = simulate(subject, { knows: () => true, roundsPerDay: 20 });
    assert.equal(days, 2, 'placed on day 1, confirmed on day 2');
    assert.equal(E.stats(save, save.done).grown, total);
    assert.equal(save.badges.length, E.SUBJECTS[subject].groups.length);
  });

  test(`${subject}: a child who must be taught every fact still finishes`, () => {
    const { days, save } = simulate(subject, { knows: (id, taught) => taught, roundsPerDay: 1 });
    assert.ok(Number.isFinite(days), 'finished');
    console.log(`      taught from zero, 1 round a day: ${days} days`);
    const two = simulate(subject, { knows: (id, taught) => taught, roundsPerDay: 2 });
    console.log(`      taught from zero, 2 rounds a day: ${two.days} days`);
    assert.ok(two.days <= days);
    assert.ok(Object.values(save.facts).every(f => f.s === 4));
  });

  test(`${subject}: right but slow answers never count as memorised`, () => {
    const { days, save } = simulate(subject, { knows: () => true, ms: 60000, roundsPerDay: 3, maxDays: 30 });
    assert.equal(days, Infinity);
    assert.equal(E.stats(save, Date.now()).grown, 0);
  });
}

test('a new fact she misses is taught, retried, then waits for tomorrow', () => {
  let now = new Date(2026, 0, 5, 16).getTime();
  const save = E.newSave(now, 'times', 'T');
  const round = E.startRound();
  const q = { id: '7x8', kind: 'x', mode: 'new', stage: 0, x: 7, op: '×', y: 8, ans: 56 };
  let res = E.answer(save, round, q, 54, 2000, now);
  assert.equal(res.event, 'teach'); assert.equal(save.facts['7x8'].s, 0);
  assert.deepEqual(round.retries, [{ id: '7x8', wait: 2, mode: 'new' }]);
  res = E.answer(save, round, q, 56, 1000, now);           // fast, but she was just shown it
  assert.equal(res.event, 'warmed'); assert.equal(save.facts['7x8'].s, 1);
  res = E.answer(save, round, { ...q, mode: 'again' }, 56, 1000, now);
  assert.equal(res.event, 'cracked'); assert.equal(save.facts['7x8'].s, 2);
  assert.equal(save.facts['7x8'].due, E.dayStart(now, 1));
  now = E.dayStart(now, 1) + 9 * HOUR;
  res = E.answer(save, E.startRound(), { ...q, mode: 'due' }, 56, 2000, now);
  assert.equal(res.event, 'hatched'); assert.equal(save.facts['7x8'].due, E.dayStart(now, 2));
  now = E.dayStart(now, 2) + 9 * HOUR;
  res = E.answer(save, E.startRound(), { ...q, mode: 'due' }, 56, 2000, now);
  assert.equal(res.event, 'grown'); assert.equal(save.facts['7x8'].s, 4);
});

test('forgetting a memorised fact sends it back to be relearned', () => {
  const now = new Date(2026, 0, 5, 16).getTime();
  const save = E.newSave(now, 'times', 'T');
  save.facts['6x7'] = { s: 4, due: 0, seen: 1, r: 5, w: 0, last: 0 };
  const round = E.startRound();
  const q = { id: '6x7', kind: 'x', mode: 'due', stage: 4, x: 6, op: '×', y: 7, ans: 42 };
  const res = E.answer(save, round, q, 48, 2000, now);
  assert.equal(res.event, 'slipped'); assert.equal(save.facts['6x7'].s, 2);
  const fix = E.answer(save, round, { ...q, mode: 'fix' }, 42, 2000, now);
  assert.equal(fix.event, 'fixed'); assert.equal(save.facts['6x7'].s, 2);
  assert.equal(save.facts['6x7'].due, E.dayStart(now, 1));
});

test('saved progress survives a round trip and bad data is rejected', () => {
  const { save } = simulate('plusminus', { knows: () => true, roundsPerDay: 2, maxDays: 1 });
  const back = E.repair(JSON.parse(JSON.stringify(save)), Date.now());
  assert.deepEqual(back.facts, save.facts);
  assert.equal(back.seeds, save.seeds);
  const newer = E.repair({ subject: 'nope', facts: {} }, 0);
  assert.equal(newer.subject, 'times', 'a subject from a newer version is parked, not rejected');
  assert.deepEqual(newer.tracks.nope, { facts: {} });
  assert.equal(E.repair(null, 0), null);
  assert.equal(E.repair({ subject: 'times' }, 0), null);
  const patched = E.repair({ subject: 'times', name: 'x', facts: { '7x8': { s: 99 } } }, 0);
  assert.equal(patched.facts['7x8'].s, 4);
  assert.equal(Object.keys(patched.facts).length, 55);
});

test('streak counts days in a row', () => {
  const now = new Date(2026, 0, 10, 16).getTime();
  const save = E.newSave(now, 'times', 'T');
  for (const d of [0, -1, -2, -4]) save.days[E.dateKey(E.dayStart(now, d))] = { q: 12, ok: 10, rounds: 1, hatched: 0, grown: 0 };
  assert.equal(E.stats(save, now).streak, 3);
  delete save.days[E.dateKey(now)];
  assert.equal(E.stats(save, now).streak, 2, 'yesterday still counts until today is over');
});

test('spelling answers ignore capitals and spaces, and get more time per letter', () => {
  assert.equal(E.same(' Because ', 'because'), true);
  assert.equal(E.same('becuase', 'because'), false);
  assert.equal(E.same('056', 56), true);
  assert.equal(E.same('57', 56), false);
  const f = E.SUBJECTS.spell3.byId['w3:because'], q = Object.assign({ id: f.id, kind: 'w' }, E.pose(f, true));
  assert.equal(q.ans, 'because');
  assert.ok(E.limits(q).solid > E.SOLID_MS);
  assert.equal(E.limits({ kind: 'x', ans: 56 }).solid, E.SOLID_MS);
  let now = new Date(2026, 0, 5, 16).getTime();
  const save = E.newSave(now, 'spell3', 'T'), round = E.startRound();
  const res = E.answer(save, round, { ...q, mode: 'new', stage: 0 }, 'becuase', 3000, now);
  assert.equal(res.correct, false); assert.equal(res.event, 'teach');
});

test('levels: stars needed climb, and level 20 is the top', () => {
  assert.equal(E.levelInfo(0).level, 1);
  assert.equal(E.levelInfo(5).level, 1);
  assert.equal(E.levelInfo(6).level, 2);
  assert.deepEqual(E.levelInfo(8), { level: 2, into: 2, need: 12, max: false });
  assert.equal(E.levelInfo(E.starsFor(20) - 1).level, 19);
  assert.deepEqual(E.levelInfo(99999), { level: 20, into: 99999 - E.starsFor(20), need: 0, max: true });
});

test('stars come from eggs moving forward, not from bonus practice', () => {
  let now = new Date(2026, 0, 5, 16).getTime();
  const save = E.newSave(now, 'times', 'T'), round = E.startRound();
  const q = { id: '2x3', kind: 'x', mode: 'new', stage: 0, x: 2, op: '×', y: 3, ans: 6 };
  const placed = E.answer(save, round, q, 6, 1000, now);
  assert.equal(placed.event, 'placed'); assert.equal(placed.stars, E.STARS.hatched);
  const before = save.stars;
  const practice = E.answer(save, round, { ...q, mode: 'practice', stage: 3 }, 6, 1000, now);
  assert.equal(practice.event, 'practice'); assert.equal(practice.stars, 0);
  const questStars = practice.quests.filter(x => x.type !== 'all').length * E.STARS.quest;
  assert.equal(save.stars, before + questStars);
  now = E.dayStart(now, 1) + 9 * HOUR;
  const grown = E.answer(save, E.startRound(), { ...q, mode: 'due', stage: 3 }, 6, 1000, now);
  assert.equal(grown.event, 'grown'); assert.equal(grown.stars, E.STARS.grown);
});

test('daily quests: same list all day, new list tomorrow, rewards paid once', () => {
  let now = new Date(2026, 0, 5, 16).getTime();
  const save = E.newSave(now, 'times', 'T');
  const first = E.ensureQuests(save, now);
  assert.equal(first.list.length, 3);
  assert.equal(E.ensureQuests(save, now + HOUR), first);
  const twin = E.newSave(now, 'times', 'T'); twin.id = save.id;
  assert.deepEqual(E.ensureQuests(twin, now).list, first.list);
  for (const q of first.list) assert.ok(['rounds', 'right', 'streak', 'quick', 'warm'].includes(q.type), q.type + ' is not doable on day one');
  save.quests = { day: E.dateKey(now), run: 0, bonus: false, list: [{ type: 'right', goal: 2, n: 0, done: false }, { type: 'streak', goal: 2, n: 0, done: false }, { type: 'rounds', goal: 1, n: 0, done: false }] };
  const round = E.startRound(), q = { id: '2x3', kind: 'x', mode: 'practice', stage: 0, x: 2, op: '×', y: 3, ans: 6 };
  assert.deepEqual(E.answer(save, round, q, 6, 9000, now).quests, []);
  assert.equal(E.answer(save, round, q, 7, 9000, now).correct, false);
  assert.equal(save.quests.run, 0, 'a miss resets the in-a-row count');
  const seeds = save.seeds, stars = save.stars;
  const hit = E.answer(save, round, q, 6, 9000, now).quests;
  assert.deepEqual(hit, [{ type: 'right', goal: 2 }]);
  assert.deepEqual(E.answer(save, round, q, 6, 9000, now).quests, [{ type: 'streak', goal: 2 }]);
  assert.deepEqual(E.finishRound(save, round, now), [{ type: 'rounds', goal: 1 }, { type: 'all', goal: 3 }]);
  assert.equal(save.seeds, seeds + 2 /* two practice answers */ + 15 * 3 + 25);
  assert.equal(save.stars, stars + E.STARS.quest * 3);
  assert.deepEqual(E.finishRound(save, E.startRound(), now), [], 'nothing is paid twice');
  now = E.dayStart(now, 1) + 9 * HOUR;
  assert.notEqual(E.ensureQuests(save, now).day, first.day);
  assert.equal(save.quests.list.every(x => !x.done), true);
});

test('boss eggs: appear when a set has hatched, one try a day, never move eggs forward', () => {
  let now = new Date(2026, 0, 5, 16).getTime();
  const save = E.newSave(now, 'times', 'T');
  assert.deepEqual(E.bossList(save, now), []);
  const g = E.SUBJECTS.times.groups.find(x => x.key === 'x7');
  for (const id of g.ids) save.facts[id] = { s: 3, due: E.dayStart(now, 2), seen: 1, r: 2, w: 0, last: 0 };
  assert.deepEqual(E.bossList(save, now), [{ key: 'x7', label: '×7', canTry: true }]);
  let boss = E.startBoss(save, 'x7', now, seeded(3));
  assert.equal(boss.qs.length, 10);
  for (const q of boss.qs) assert.ok(q.x === 7 || q.y === 7);
  assert.equal(E.bossList(save, now)[0].canTry, false);
  let res;
  for (let i = 0; i < 3; i++) res = E.bossAnswer(save, boss, boss.qs[boss.i].ans + 1, now);
  assert.equal(res.over, 'lose');
  assert.equal(g.ids.filter(id => save.facts[id].due === now).length, 3, 'the three missed facts are due again');
  assert.ok(g.ids.every(id => save.facts[id].s === 3), 'no egg moved');
  assert.ok(!save.bosses.x7.won);
  now = E.dayStart(now, 1) + 9 * HOUR;
  assert.equal(E.bossList(save, now)[0].canTry, true);
  boss = E.startBoss(save, 'x7', now, seeded(4));
  const seeds = save.seeds, stars = save.stars;
  E.bossAnswer(save, boss, boss.qs[boss.i].ans + 1, now);
  for (let i = 0; i < 9; i++) res = E.bossAnswer(save, boss, boss.qs[boss.i].ans, now);
  assert.equal(res.over, 'win');
  assert.equal(save.seeds - seeds, 9 + 40 + (res.quests.filter(x => x.type !== 'all').length * 15) + (res.quests.some(x => x.type === 'all') ? 25 : 0));
  assert.ok(save.stars - stars >= E.STARS.boss);
  assert.deepEqual(E.bossList(save, now), [], 'a beaten boss does not come back');
  assert.ok(g.ids.every(id => save.facts[id].s === 3));
});

test('speed nest: opens at level 3 with 8 hatched pets, pays seeds once a day', () => {
  const now = new Date(2026, 0, 5, 16).getTime();
  const save = E.newSave(now, 'plusminus', 'T');
  assert.equal(E.speedOpen(save), false);
  const ids = E.SUBJECTS.plusminus.facts.slice(0, 8).map(f => f.id);
  for (const id of ids) save.facts[id].s = 3;
  assert.equal(E.speedOpen(save), false, 'still level 1');
  save.stars = E.starsFor(3);
  assert.equal(E.speedOpen(save), true);
  const rnd = seeded(9);
  let last = null;
  for (let i = 0; i < 200; i++) { const q = E.speedQuestion(save, last, rnd); assert.ok(ids.includes(q.id)); assert.notEqual(q.id, last); last = q.id; }
  save.quests = { day: E.dateKey(now), run: 0, bonus: true, list: [] };
  const a = E.speedFinish(save, 12, now);
  assert.deepEqual([a.best, a.seeds, a.stars], [true, 12, E.STARS.best]);
  const b = E.speedFinish(save, 45, now);
  assert.deepEqual([b.best, b.seeds], [true, 0], 'second dash of the day pays no seeds');
  const c = E.speedFinish(save, 20, now);
  assert.deepEqual([c.best, c.seeds, c.stars], [false, 0, 0]);
  assert.equal(save.speedBest, 45);
  const d = E.speedFinish(save, 99, E.dayStart(now, 1) + HOUR);
  assert.equal(d.seeds, 30, 'capped');
});

test('a save from the first version still loads, keeps its hats, and gets stars for past work', () => {
  const now = new Date(2026, 0, 5, 16).getTime();
  const old = { id: 'p1', name: 'Ada', subject: 'times', created: 1, seeds: 29, hats: ['party', 'fish'], worn: { '1x3': 'fish' }, days: { '2026-01-04': { q: 12, ok: 10, rounds: 1, hatched: 5, grown: 0 } },
    badges: [], done: 0, sound: true, mic: false, facts: { '1x1': { s: 3, due: 5, seen: 1, r: 2, w: 0, last: 1 }, '1x3': { s: 4, due: 5, seen: 1, r: 3, w: 0, last: 1 }, '1x8': { s: 2, due: 5, seen: 1, r: 2, w: 1, last: 1 } } };
  const p = E.repair(JSON.parse(JSON.stringify(old)), now);
  assert.deepEqual(p.owned, ['party', 'fish']);
  assert.equal('hats' in p, false);
  assert.deepEqual(p.worn, { '1x3': { hat: 'fish' } });
  assert.equal(p.stars, E.STARS.hatched * 2 + E.STARS.grown);
  assert.equal(E.levelInfo(p.stars).level, 2);
  assert.deepEqual([p.seeds, p.seenLevel, p.bed, p.speedBest, p.quests], [29, 1, '', 0, null]);
  assert.deepEqual(p.bosses, {});
  assert.equal(p.facts['1x8'].s, 2); assert.equal(p.facts['1x8'].w, 1);
  assert.equal(p.days['2026-01-04'].q, 12);
  const again = E.repair(JSON.parse(JSON.stringify(p)), now);
  assert.deepEqual(again, p, 'loading twice changes nothing');
  const round = E.startRound(), q = E.nextQuestion(p, round, now);
  assert.ok(q && E.answer(p, round, q, q.ans, 1000, now).correct);
});

test('one player, several subjects: progress is kept apart, the wallet is shared', () => {
  const now = new Date(2026, 0, 5, 16).getTime();
  const save = E.newSave(now, 'times', 'Ada');
  assert.deepEqual(E.subjectsOf(save), ['times']);
  const round = E.startRound();
  let q = E.nextQuestion(save, round, now, seeded(1));
  E.answer(save, round, q, q.ans, 1000, now);
  save.owned.push('party'); save.bed = 'straw'; save.worn[q.id] = { hat: 'party' }; save.badges.push('x1');
  const wallet = () => [save.id, save.name, save.seeds, save.stars, save.seenLevel, save.owned.join(), save.bed, JSON.stringify(save.quests), JSON.stringify(save.days)];
  const before = wallet(), timesFacts = JSON.stringify(save.facts), timesWorn = JSON.stringify(save.worn);

  E.switchSubject(save, 'spell3');
  assert.equal(save.subject, 'spell3');
  assert.deepEqual(E.subjectsOf(save), ['times', 'spell3']);
  assert.deepEqual(wallet(), before, 'seeds, stars, level, shop items, bed and quests travel with her');
  assert.equal(Object.keys(save.facts).length, 60);
  assert.ok(Object.values(save.facts).every(f => f.s === 0));
  assert.deepEqual([save.worn, save.badges, save.bosses, save.done, save.speedBest], [{}, [], {}, 0, 0]);
  assert.equal(E.stats(save, now).total, 60);

  q = E.nextQuestion(save, E.startRound(), now, seeded(1));
  assert.equal(q.kind, 'w');
  const res = E.answer(save, E.startRound(), q, q.ans, 1000, now);
  assert.equal(res.event, 'placed');
  assert.ok(save.seeds > before[2] && save.stars > before[3], 'spelling earns into the same wallet');
  const spellFacts = JSON.stringify(save.facts);

  E.switchSubject(save, 'times');
  assert.equal(JSON.stringify(save.facts), timesFacts);
  assert.equal(JSON.stringify(save.worn), timesWorn);
  assert.deepEqual(save.badges, ['x1']);
  assert.deepEqual(E.subjectsOf(save), ['times', 'spell3']);
  assert.equal(JSON.stringify(save.tracks.spell3.facts), spellFacts);
  assert.equal(E.switchSubject(save, 'times'), save, 'switching to the same subject changes nothing');
  assert.equal(E.switchSubject(save, 'nope').subject, 'times');

  const back = E.repair(JSON.parse(JSON.stringify(save)), now);
  assert.deepEqual(back, save, 'save, close, reopen: nothing lost');
  const junk = JSON.parse(JSON.stringify(save));
  junk.tracks.nope = { facts: {} }; junk.tracks.times = { facts: {} }; junk.tracks.spell5 = 'broken'; junk.tracks.spell3.facts['w3:said'].s = 99;
  const fixed = E.repair(junk, now);
  assert.deepEqual(Object.keys(fixed.tracks), ['spell3', 'nope'], 'duplicate and broken tracks are dropped; tracks this version does not know are kept');
  assert.deepEqual(fixed.tracks.nope, { facts: {} });
  assert.equal(fixed.tracks.spell3.facts['w3:said'].s, 4);
  E.switchSubject(fixed, 'spell3');
  assert.equal(fixed.facts['w3:said'].s, 4);
});

test('pet park tickets: a great round, a boss win and all quests each earn one, and they stack', () => {
  let now = new Date(2026, 0, 5, 16).getTime();
  const save = E.newSave(now, 'times', 'T');
  assert.equal(save.tickets, 0);
  const round = (ok, asked) => Object.assign(E.startRound(), { ok, asked });
  save.quests = { day: E.dateKey(now), run: 0, bonus: true, list: [] };
  E.finishRound(save, round(9, 12), now); assert.equal(save.tickets, 1, '9 of 12 earns one');
  E.finishRound(save, round(8, 12), now); assert.equal(save.tickets, 1, '8 of 12 does not');
  E.finishRound(save, round(3, 4), now); assert.equal(save.tickets, 2, 'a short round at 75% counts');
  E.finishRound(save, round(0, 0), now); assert.equal(save.tickets, 2, 'an empty round earns nothing');
  assert.equal(save.days[E.dateKey(now)].tix, 2);
  const g = E.SUBJECTS.times.groups.find(x => x.key === 'x7');
  for (const id of g.ids) save.facts[id] = { s: 3, due: E.dayStart(now, 2), seen: 1, r: 2, w: 0, last: 0 };
  const boss = E.startBoss(save, 'x7', now, seeded(4));
  let res; for (let i = 0; i < 10; i++) res = E.bossAnswer(save, boss, boss.qs[boss.i].ans, now);
  assert.equal(res.over, 'win'); assert.equal(save.tickets, 3, 'a boss win earns one');
  save.quests = { day: E.dateKey(now), run: 0, bonus: false, list: [{ type: 'rounds', goal: 1, n: 0, done: false }] };
  E.finishRound(save, round(0, 12), now); assert.equal(save.tickets, 4, 'all quests done earns one');
  E.finishRound(save, round(0, 12), now); assert.equal(save.tickets, 4, 'the quest ticket is paid once a day');
  now = E.dayStart(now, 1) + 9 * HOUR;
  save.quests = { day: E.dateKey(now), run: 0, bonus: false, list: [{ type: 'rounds', goal: 1, n: 0, done: false }] };
  E.finishRound(save, round(12, 12), now); assert.equal(save.tickets, 6, 'great round + last quest = 2');
  assert.equal(save.days[E.dateKey(now)].tix, 2);
});

test('pet park games: unlock by level, cost one ticket, keep bests, pay nothing', () => {
  const now = new Date(2026, 0, 5, 16).getTime();
  const save = E.newSave(now, 'times', 'T');
  assert.deepEqual(E.GAMES.map(g => [g.id, g.level]), [['catch', 2], ['pop', 4], ['memory', 6]]);
  assert.deepEqual(E.gamesOpen(save), []);
  save.stars = E.starsFor(4);
  assert.deepEqual(E.gamesOpen(save), ['catch', 'pop']);
  assert.equal(E.startGame(save, 'catch', now), false, 'no ticket');
  save.tickets = 1;
  assert.equal(E.startGame(save, 'memory', now), false, 'locked');
  assert.equal(E.startGame(save, 'nope', now), false);
  assert.equal(save.tickets, 1);
  assert.equal(E.startGame(save, 'catch', now), true);
  assert.equal(save.tickets, 0);
  assert.equal(save.days[E.dateKey(now)].games, 1);
  assert.equal(E.startGame(save, 'catch', now), false, 'one ticket, one game');
  const seeds = save.seeds, stars = save.stars;
  assert.deepEqual(E.gameFinish(save, 'catch', 0), { best: false });
  assert.deepEqual(E.gameFinish(save, 'catch', 12), { best: true });
  assert.deepEqual(E.gameFinish(save, 'catch', 9), { best: false });
  assert.deepEqual(E.gameFinish(save, 'memory', 14), { best: true });
  assert.deepEqual(E.gameFinish(save, 'memory', 18), { best: false });
  assert.deepEqual(E.gameFinish(save, 'memory', 11), { best: true }, 'fewer moves is better');
  assert.deepEqual(save.arcade.best, { catch: 12, memory: 11 });
  assert.deepEqual([save.seeds, save.stars], [seeds, stars], 'games pay no seeds or stars');
});

test('pet park saves: old saves get no tickets, bad data is fixed, tickets travel across subjects', () => {
  const now = new Date(2026, 0, 5, 16).getTime();
  const save = E.newSave(now, 'times', 'T');
  const old = JSON.parse(JSON.stringify(save)); delete old.tickets; delete old.arcade;
  const p = E.repair(old, now);
  assert.deepEqual([p.tickets, p.arcade], [0, { best: {} }]);
  const j = E.repair(Object.assign(JSON.parse(JSON.stringify(save)), { tickets: -4, arcade: { best: { catch: 'x', pop: 7.6, memory: -2, nope: 5 } } }), now);
  assert.deepEqual([j.tickets, j.arcade], [0, { best: { pop: 7, nope: 5 } }], 'bad bests are dropped; a game this version does not know keeps its best');
  assert.deepEqual(E.repair(JSON.parse(JSON.stringify(j)), now), j, 'loading twice changes nothing');
  assert.deepEqual(E.repair(Object.assign(JSON.parse(JSON.stringify(save)), { arcade: 'broken' }), now).arcade, { best: {} });
  save.tickets = 3; save.arcade.best.catch = 20;
  E.switchSubject(save, 'spell3');
  assert.deepEqual([save.tickets, save.arcade.best.catch], [3, 20]);
});

test('pet park pets: most grown first, current subject first, outfits from every subject, no cold eggs', () => {
  const now = new Date(2026, 0, 5, 16).getTime();
  const save = E.newSave(now, 'times', 'T');
  assert.deepEqual(E.petRoster(save), []);
  save.facts['2x3'].s = 1; save.facts['2x4'].s = 3; save.facts['5x5'].s = 4; save.worn['5x5'] = { hat: 'crown' };
  E.switchSubject(save, 'spell3');
  save.facts['w3:said'].s = 4; save.worn['w3:said'] = { hat: 'party' }; save.facts['w3:they'].s = 2;
  assert.deepEqual(E.petRoster(save), [
    { id: 'w3:said', stage: 4, wear: { hat: 'party' } },
    { id: '5x5', stage: 4, wear: { hat: 'crown' } },
    { id: '2x4', stage: 3, wear: {} },
    { id: 'w3:they', stage: 2, wear: {} },
    { id: '2x3', stage: 1, wear: {} },
  ]);
});

test('a save from a newer version keeps everything this version does not know', () => {
  const now = Date.UTC(2026, 10, 13, 12);
  // known open subject, with a newer subject parked, a newer field on a known track, and newer fields on facts
  const s = E.newSave(now, 'times', 'Rae');
  E.switchSubject(s, 'spell3');
  s.tracks.times.checkup = { day: '2026-11-01', score: 7 };
  s.tracks.times.facts['6x7'].streak = 3;
  s.facts['w3:said'].hint = 'slowly';
  const frac = { facts: { 'f:1/2': { s: 2, due: 5, extra: true } }, worn: {}, badges: ['f1'], bosses: {}, done: 0, speedBest: 4, speedDay: '', checkup: { n: 1 } };
  s.tracks.frac = JSON.parse(JSON.stringify(frac));
  const a = E.repair(JSON.parse(JSON.stringify(s)), now);
  assert.deepEqual(a.tracks.frac, frac, 'a newer subject waits untouched');
  assert.deepEqual(a.tracks.times.checkup, { day: '2026-11-01', score: 7 });
  assert.equal(a.tracks.times.facts['6x7'].streak, 3);
  assert.equal(a.facts['w3:said'].hint, 'slowly');
  assert.deepEqual(E.subjectsOf(a), ['times', 'spell3'], 'the newer subject is never shown');
  assert.deepEqual(E.repair(JSON.parse(JSON.stringify(a)), now), a, 'repairing twice changes nothing');

  // a newer subject is the one that was open: it is parked, and a subject this version knows opens instead
  const b = JSON.parse(JSON.stringify(s));
  b.subject = 'div'; b.facts = { 'd:6/3': { s: 3, due: 9, extra: 1 } }; b.worn = { 'd:6/3': { hat: 'cap' } }; b.badges = ['d1']; b.bosses = {}; b.done = 0; b.speedBest = 2; b.speedDay = 'x';
  delete b.tracks.frac;
  const r = E.repair(JSON.parse(JSON.stringify(b)), now);
  assert.ok(r, 'not thrown away');
  assert.equal(r.subject, 'times', 'opens the first parked subject this version knows');
  assert.deepEqual(r.tracks.div, { facts: { 'd:6/3': { s: 3, due: 9, extra: 1 } }, worn: { 'd:6/3': { hat: 'cap' } }, badges: ['d1'], bosses: {}, done: 0, speedBest: 2, speedDay: 'x' });
  assert.equal(r.facts['6x7'].streak, 3, 'the opened subject keeps its own facts');
  assert.deepEqual(Object.keys(r.tracks), ['div'], 'the opened subject leaves the parked list');
  assert.equal(r.stars, s.stars); assert.equal(r.seeds, s.seeds); assert.equal(r.name, 'Rae');
  assert.deepEqual(E.repair(JSON.parse(JSON.stringify(r)), now), r, 'repairing twice changes nothing');

  // a newer subject with nothing this version knows parked: a fresh first subject opens
  const c = E.repair({ id: 'p1', name: 'Rae', subject: 'div', facts: { 'd:6/3': { s: 1 } }, stars: 30, tracks: {} }, now);
  assert.equal(c.subject, Object.keys(E.SUBJECTS)[0]);
  assert.deepEqual(c.tracks.div.facts, { 'd:6/3': { s: 1 } });
  assert.equal(c.stars, 30);
  assert.equal(E.repair({ name: 'x', facts: {} }, now), null, 'no subject at all is still not a save');
});

test('cloud: loginOf turns a name into a login', () => {
  assert.equal(E.loginOf('Layla'), 'layla');
  assert.equal(E.loginOf('  Layla S! '), 'laylas');
  assert.equal(E.loginOf('Rae2'), 'rae2');
  assert.equal(E.loginOf('Zoë'), 'zo', 'only a-z and 0-9 are kept');
  assert.equal(E.loginOf('🐣🐣'), '');
  assert.equal(E.loginOf(''), '');
  assert.equal(E.loginOf(undefined), '');
  assert.equal(E.loginOf('abcdefghijklmnopqrstuvwxyz'), 'abcdefghijklmnop', 'cut to 16');
});

test('cloud: PIN, email and password', () => {
  for (const ok of ['0000', '1234', '9876']) assert.equal(E.pinOK(ok), true, ok);
  for (const bad of ['123', '12345', '12a4', ' 1234', '', undefined, 1234]) assert.equal(E.pinOK(bad), false, String(bad));
  assert.equal(E.loginEmail('layla'), 'layla@players.odd-egg-hatchery.invalid');
  assert.equal(E.pinPassword('1234'), 'egg-1234-hatch');
});

test('cloud: localWins keeps the copy with more progress', () => {
  const now = Date.UTC(2026, 10, 13, 12);
  const a = E.newSave(now, 'times', 'A'), b = E.newSave(now, 'times', 'A');
  assert.deepEqual(E.progressOf(a), { stars: 0, q: 0 });
  a.stars = 50; b.stars = 40;
  assert.equal(E.localWins(a, b), true, 'more stars wins');
  assert.equal(E.localWins(b, a), false);
  b.stars = 50;
  a.days = { '2026-11-12': { q: 10, ok: 8, rounds: 1, hatched: 0, grown: 0 } };
  b.days = { '2026-11-12': { q: 5, ok: 5, rounds: 1, hatched: 0, grown: 0 }, '2026-11-13': { q: 3, ok: 3, rounds: 1, hatched: 0, grown: 0 } };
  assert.deepEqual(E.progressOf(b), { stars: 50, q: 8 });
  assert.equal(E.localWins(a, b), true, 'a star tie goes to more questions answered');
  b.days['2026-11-13'].q = 5;
  assert.equal(E.localWins(a, b), false, 'a full tie keeps the cloud copy');
});

test('cloud: syncPlan decides what to do with a save', () => {
  const now = Date.UTC(2026, 10, 13, 12);
  const more = Object.assign(E.newSave(now, 'times', 'A'), { stars: 90 });
  const less = Object.assign(E.newSave(now, 'times', 'A'), { stars: 10 });
  const doc = (rev, save) => ({ rev, save });
  assert.deepEqual(E.syncPlan({ rev: 0, dirty: true }, null, less), { act: 'push' }, 'nothing in the cloud yet');
  assert.deepEqual(E.syncPlan({ rev: 0, dirty: false }, null, less), { act: 'push' });
  assert.deepEqual(E.syncPlan({ rev: 2, dirty: false, force: true }, doc(5, more), less), { act: 'push', force: true, drop: 'cloud' }, 'a restore always goes up, and the copy it replaces is kept');
  assert.deepEqual(E.syncPlan({ rev: 5, dirty: false }, doc(5, more), less), { act: 'none' });
  assert.deepEqual(E.syncPlan({ rev: 5, dirty: true }, doc(5, more), less), { act: 'push' });
  assert.deepEqual(E.syncPlan({ rev: 4, dirty: false }, doc(5, less), more), { act: 'take' }, 'a stale computer takes the newer cloud copy');
  assert.deepEqual(E.syncPlan({ rev: 4, dirty: true }, doc(5, less), more), { act: 'push', force: true, drop: 'cloud' }, 'both changed: more stars here');
  assert.deepEqual(E.syncPlan({ rev: 4, dirty: true }, doc(5, more), less), { act: 'take', drop: 'local' }, 'both changed: more stars in the cloud');
  assert.deepEqual(E.syncPlan({ rev: 7, dirty: false }, doc(5, more), less), { act: 'push', force: true, drop: 'cloud' }, 'this computer is ahead of the cloud: the cloud copy is kept before it is replaced');
  assert.deepEqual(E.syncPlan({ rev: 0, dirty: true, force: true }, null, less), { act: 'push' }, 'a restore with nothing in the cloud has nothing to keep');
});

console.log(`\n${passed} tests passed`);
