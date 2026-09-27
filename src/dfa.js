// Subset construction (NFA → DFA) + minimization (Moore refinement).
//
// DFA states are named by the SORTED set of NFA state ids they contain —
// canonical keys, comparable for free. The alphabet is the set of labels
// on NFA char edges; wildcard edges (the unanchored ".*" prefix loop) are
// excluded from the alphabet and instead become a **default transition**
// on each DFA state — the classic way to model "any character not listed".
//
// Anchors in DFA-land:
//   '^' edges are crossed only when building the START state's closure
//   (a '^' pattern has no prefix loop, so DFA state 0 IS position zero);
//   '$' edges are crossed freely but, when the pattern is end-anchored,
//   accept states are marked acceptAtEnd — the matcher honours that flag
//   only at the last input position.

const nextChar = (c) => String.fromCharCode(c.charCodeAt(0) + 1);

export function buildDfa(nfa) {
  // The alphabet is derived from character-class BOUNDARIES: every range
  // endpoint and its successor becomes a breakpoint; the intervals between
  // consecutive breakpoints are indistinguishable for every edge, so one
  // representative char per interval suffices to build the whole DFA.
  const points = new Set();
  const collect = (s, seen = new Set()) => {
    if (seen.has(s)) return;
    seen.add(s);
    for (const tr of s.trans) {
      if (tr.test && !tr.wildcard && tr.items) {
        for (const it of tr.items) { points.add(it.lo); points.add(nextChar(it.hi)); }
      } else if (tr.test && !tr.wildcard && tr.label && tr.label.length === 1) {
        points.add(tr.label);
        points.add(nextChar(tr.label));
      }
      collect(tr.to, seen); // anchor edges gate matching, not reachability
    }
    for (const t of s.eps) collect(t, seen);
  };
  collect(nfa.start);
  const sorted = [...points].sort();
  const alphabet = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i + 1 < sorted.length && sorted[i + 1] > sorted[i]) alphabet.push(sorted[i]);
  }
  if (sorted.length) alphabet.push(sorted[sorted.length - 1]); // tail interval starts AT the last boundary

  const closure = (stateSet, allowStartAnchor) => {
    const stack = [...stateSet];
    const seen = new Set(stateSet);
    while (stack.length) {
      const s = stack.pop();
      for (const t of s.eps) if (!seen.has(t)) { seen.add(t); stack.push(t); }
      for (const tr of s.trans) {
        if (tr.anchorStart && allowStartAnchor && !seen.has(tr.to)) { seen.add(tr.to); stack.push(tr.to); }
        if (tr.anchorEnd && !seen.has(tr.to)) { seen.add(tr.to); stack.push(tr.to); }
      }
    }
    return seen;
  };

  const states = [];
  const index = new Map();
  const worklist = [];

  // With '$' allowed only at the pattern end, an accept state reached
  // through the '$' edge carries end-of-input semantics.
  const kindOf = (set) => (
    nfa.endAnchored
      ? { accept: false, acceptAtEnd: set.has(nfa.accept) }
      : { accept: set.has(nfa.accept), acceptAtEnd: false }
  );

  const getId = (set, allowStartAnchor = false) => {
    const closed = closure(set, allowStartAnchor);
    const key = [...closed].map((s) => s.id).sort((a, b) => a - b).join(',');
    if (index.has(key)) return index.get(key);
    const id = states.length;
    const { accept, acceptAtEnd } = kindOf(closed);
    states.push({ key, trans: new Map(), default: undefined, accept, acceptAtEnd });
    index.set(key, id);
    worklist.push([closed, id]);
    return id;
  };

  getId(new Set([nfa.start]), true);

  while (worklist.length) {
    const [set, id] = worklist.shift();
    let wildcardMoved = new Set();
    for (const s of set) {
      for (const tr of s.trans) if (tr.wildcard) wildcardMoved.add(tr.to);
    }
    for (const label of alphabet) {
      const moved = new Set();
      for (const s of set) {
        for (const tr of s.trans) {
          if (tr.test && (tr.wildcard || tr.test(label))) {
            moved.add(tr.to);
          }
        }
      }
      if (!moved.size) continue;
      states[id].trans.set(label, getId(moved));
    }
    if (wildcardMoved.size) {
      states[id].default = getId(wildcardMoved);
    }
  }

  return { states, alphabet, boundaries: sorted, start: 0, endAnchored: !!nfa.endAnchored };
}

/** Moore partition refinement — merges indistinguishable states. */
export function minimize(dfa) {
  const { states, alphabet } = dfa;
  let groups = states.map((s) => (s.acceptAtEnd ? 2 : s.accept ? 0 : 1));

  while (true) {
    const sigToGroup = new Map();
    const next = new Array(states.length);
    for (let i = 0; i < states.length; i++) {
      const sig = [groups[i],
        ...alphabet.map((l) => {
          const t = states[i].trans.get(l);
          return t === undefined ? -1 : groups[t];
        }),
        states[i].default === undefined ? -1 : groups[states[i].default]].join(',');
      if (!sigToGroup.has(sig)) sigToGroup.set(sig, sigToGroup.size);
      next[i] = sigToGroup.get(sig);
    }
    const before = new Set(groups).size;
    groups = next;
    if (new Set(groups).size === before) break;
  }

  const repOf = new Map();
  for (let i = 0; i < states.length; i++) {
    if (!repOf.has(groups[i])) repOf.set(groups[i], i);
  }
  const repIds = [...new Set(repOf.values())].sort((a, b) => a - b);
  const newId = new Map(repIds.map((id, k) => [id, k]));

  const newStates = repIds.map((id) => ({
    key: states[id].key,
    trans: new Map(),
    default: undefined,
    accept: states[id].accept,
    acceptAtEnd: states[id].acceptAtEnd,
  }));
  repIds.forEach((id, k) => {
    for (const [label, target] of states[id].trans) {
      newStates[k].trans.set(label, newId.get(repOf.get(groups[target])));
    }
    if (states[id].default !== undefined) {
      newStates[k].default = newId.get(repOf.get(groups[states[id].default]));
    }
  });

  return { states: newStates, alphabet, boundaries: dfa.boundaries, start: 0, endAnchored: dfa.endAnchored };
}

/** Map an input char to its interval representative (binary search). */
function repOfChar(dfa, ch) {
  const b = dfa.boundaries;
  let lo = 0, hi = b.length - 1, rep = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (b[mid] <= ch) { rep = b[mid]; lo = mid + 1; }
    else hi = mid - 1;
  }
  return rep;
}

/** DFA scan — O(n) no matter how pathological the pattern is. */
export function dfaMatches(dfa, input) {
  let steps = 0;
  let state = dfa.start;
  let accepted = dfa.states[state].accept;
  let acceptedAtEnd = dfa.states[state].acceptAtEnd;
  const len = input.length;
  for (let i = 0; i < len; i++) {
    steps++;
    const rep = repOfChar(dfa, input[i]);
    state = (rep !== null ? dfa.states[state].trans.get(rep) : undefined)
      ?? dfa.states[state].default ?? -1;
    if (state === -1) return { matched: accepted, steps };
    if (dfa.states[state].accept) accepted = true;
    if (dfa.states[state].acceptAtEnd && i === len - 1) acceptedAtEnd = true;
  }
  return { matched: accepted || acceptedAtEnd, steps };
}
