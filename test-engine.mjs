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
  for (const k of ['times', 'plusminus']) {
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

for (const subject of ['times', 'plusminus']) {
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
    const { days, save } = simulate(subject, { knows: () => true, ms: 12000, roundsPerDay: 3, maxDays: 30 });
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

console.log(`\n${passed} tests passed`);
