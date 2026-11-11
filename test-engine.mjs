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
  assert.equal(E.repair({ subject: 'nope', facts: {} }, 0), null);
  assert.equal(E.repair(null, 0), null);
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

console.log(`\n${passed} tests passed`);
