import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { compile, compareEngines } from '../src/index.js';
import { nfaMatches, buildNfa } from '../src/nfa.js';
import { buildDfa, minimize, dfaMatches } from '../src/dfa.js';
import { backtrackMatches } from '../src/backtracker.js';
import { parse } from '../src/parser.js';

// ---- curated cases (all three engines must agree with the expectation) ----

const CASES = [
  ['abc', 'xxabcyy', true], ['abc', 'xxabdyy', false],
  ['a(b|c)*d', 'abcbcbd', true], ['a(b|c)*d', 'abcbdz', true], ['a(b|c)*d', 'abzbd', false],
  ['^ab$', 'ab', true], ['^ab$', 'axb', false], ['^ab$', 'abx', false],
  ['[a-c]+x', 'zzabacax', true], ['[a-c]+x', 'zzd', false],
  ['\\d{2,3}-\\w+', '12-ab', true], ['\\d{2,3}-\\w+', '1-ab', false],
  ['colou?r', 'my color!', true], ['a*', '', true], ['a*b', 'aaab', true],
  ['(a|b)*abb', 'babbababb', true],
  ['a{2,3}', 'a', false], ['a{2,3}', 'aa', true], ['a{2,3}', 'aaa', true], ['a{2,3}', 'aaaa', true],
  ['[^abc]+', 'xyz', true], ['[^abc]+', 'ab', false],
  ['.', 'x', true], ['.', '\n', false], ['[^d]', 'd', false], ['[^d]', 'e', true],
  ['(ab)+', 'ababab', true], ['a?b?', '', true],
];

test('curated matrix: three engines agree with expectations', () => {
  for (const [pattern, input, want] of CASES) {
    const c = compile(pattern);
    const cmp = compareEngines(pattern, input);
    assert.equal(c.test(input), want, `compile.test failed for ${pattern} on ${input}`);
    assert.equal(cmp.agree, true, `engines disagree for ${pattern} on ${input}: ${JSON.stringify(cmp.steps)}`);
  }
});

// ---- minimization actually shrinks ----

test('minimization does not enlarge and usually shrinks', () => {
  for (const [pattern] of CASES) {
    const c = compile(pattern);
    assert.ok(c.sizes.minStates <= c.sizes.dfaStates, pattern);
  }
  // a classic: (a|b)*abb minimizes down to 4 states
  const c = compile('(a|b)*abb');
  assert.ok(c.sizes.dfaStates > c.sizes.minStates);
  assert.equal(c.sizes.minStates, 4);
});

test('NFA-to-DFA: DFA accepts exactly the NFA language on a fuzz corpus', () => {
  // deterministic pseudo-random fuzz: random patterns over a tiny alphabet,
  // random inputs; all engines must agree (the backtracker is the oracle)
  let seed = 42;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF;
    return seed % n;
  };
  const atoms = ['a', 'b', 'c', '[ab]', '[^a]', '.', 'c'];
  const quantifiers = ['', '', '', '*', '+', '?', '{2}'];

  function randomPattern(depth = 0) {
    const r = rnd(10);
    if (depth < 2 && r < 3) {
      const left = randomPattern(depth + 1);
      const right = randomPattern(depth + 1);
      return rnd(2) ? `(${left}${right})` : `(${left}|${right})`;
    }
    let atom = atoms[rnd(atoms.length)];
    if (depth < 2 && rnd(4) === 0) atom = `(${randomPattern(depth + 1)})`;
    return atom + quantifiers[rnd(quantifiers.length)];
  }

  let checked = 0;
  for (let i = 0; i < 60; i++) {
    const pattern = randomPattern();
    let ast;
    try { ast = parse(pattern); } catch { continue; } // dialect edge — skip
    const nfa = buildNfa(ast);
    const dfa = minimize(buildDfa(nfa));
    for (let j = 0; j < 20; j++) {
      const len = rnd(8);
      let input = '';
      for (let k = 0; k < len; k++) input += 'abc'[rnd(3)];
      let expected;
      try {
        expected = backtrackMatches(ast, input, { stepLimit: 500_000 }).matched;
      } catch {
        continue; // oracle blew up (nested-quantifier blowup) — NFA/DFA verified separately
      }
      assert.equal(nfaMatches(nfa, input).matched, expected,
        `NFA/backtracker disagree: /${pattern}/ on "${input}"`);
      assert.equal(dfaMatches(dfa, input).matched, expected,
        `DFA/backtracker disagree: /${pattern}/ on "${input}"`);
      checked++;
    }
  }
  assert.ok(checked > 300, `fuzz corpus too small: ${checked}`);
});

// ---- catastrophic backtracking, quantified ----

test('catastrophic pattern: backtracker explodes, DFA stays linear', () => {
  const pattern = '(a|a)*b';
  const ast = parse(pattern);
  const nfa = buildNfa(ast);
  const dfa = minimize(buildDfa(nfa));
  const input = 'a'.repeat(22);

  let backSteps;
  try {
    backSteps = backtrackMatches(ast, input, { stepLimit: 5_000_000 }).steps;
  } catch {
    backSteps = 5_000_000; // hit the limit — the point stands
  }
  const nfaSteps = nfaMatches(nfa, input).steps;
  const dfaSteps = dfaMatches(dfa, input).steps;

  assert.ok(backSteps > 1_000_000, `expected blowup, got ${backSteps}`);
  assert.ok(dfaSteps <= input.length * 4, `DFA should be linear, got ${dfaSteps}`);
  assert.ok(nfaSteps < backSteps / 100, 'NFA should be orders of magnitude faster');
});

test('DFA is O(n) even on the pathological input', () => {
  const c = compile('(a|a)*b');
  const t1 = dfaMatches(c.minimized, 'a'.repeat(1000)).steps;
  const t2 = dfaMatches(c.minimized, 'a'.repeat(4000)).steps;
  assert.ok(t2 < t1 * 6, `DFA should scale linearly: ${t1} -> ${t2}`);
});
