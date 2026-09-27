// Thompson NFA construction + linear-time simulation.
//
// States are objects:
//   eps: state[]                 — epsilon edges
//   trans: edge[]                — character edges {test, label, to}
//   anchor edges: {anchorStart|anchorEnd, to} — zero-width, position-gated
// A fragment is { start, accept }. Construction is classic Thompson glue:
// alternation fans out over fresh epsilon states, concatenation wires
// accepts to starts, `*` adds a loop plus a skip edge.
//
// Unanchored search is modelled by a wildcard prefix loop on the start
// state; a leading `^` removes it (the pattern then matches only at
// position 0). A trailing `$` gates the accept state behind an edge that
// the simulation may cross only at end of input.

let stateCounter = 0;

export function resetNfa() { stateCounter = 0; }

function newState() {
  return { eps: [], trans: [], accept: false, id: stateCounter++ };
}

export function buildNfa(ast) {
  resetNfa();
  const frag = { start: null, accept: null };

  function compileNode(node) {
    switch (node.type) {
      case 'empty': {
        const s = newState();
        return { start: s, accept: s };
      }
      case 'char': {
        const s = newState(), t = newState();
        s.trans.push({ test: (ch) => ch === node.ch, label: node.ch, to: t });
        return { start: s, accept: t };
      }
      case 'any': {
        const s = newState(), t = newState();
        s.trans.push({ test: (ch) => ch !== '\n', label: '.', to: t });
        return { start: s, accept: t };
      }
      case 'class': {
        const s = newState(), t = newState();
        const tests = node.items.map((it) => (ch) => ch >= it.lo && ch <= it.hi);
        const label = '[' + node.items.map((it) => (it.lo === it.hi ? it.lo : `${it.lo}-${it.hi}`)).join('') + (node.negated ? '^' : '') + ']';
        s.trans.push({
          test: (ch) => {
            const hit = tests.some((f) => f(ch));
            return node.negated ? !hit : hit;
          },
          label,
          items: node.items,
          to: t,
        });
        return { start: s, accept: t };
      }
      case 'anchor': {
        const s = newState(), t = newState();
        if (node.kind === '^') s.trans.push({ anchorStart: true, to: t });
        else s.trans.push({ anchorEnd: true, to: t });
        return { start: s, accept: t };
      }
      case 'concat': {
        let acc = { start: newState(), accept: null };
        acc.accept = acc.start; // empty concat: pass-through state
        let first = true;
        for (const part of node.parts) {
          const f = compileNode(part);
          if (first) { acc.start = f.start; first = false; }
          else acc.accept.eps.push(f.start);
          acc.accept = f.accept;
        }
        return acc;
      }
      case 'alt': {
        const s = newState(), t = newState();
        for (const opt of node.opts) {
          const f = compileNode(opt);
          s.eps.push(f.start);
          f.accept.eps.push(t);
        }
        return { start: s, accept: t };
      }
      case 'repeat': {
        const { min, max } = node;
        const s = newState(), t = newState();
        let current = s;
        for (let i = 0; i < min; i++) {           // mandatory copies
          const f = compileNode(node.node);
          current.eps.push(f.start);
          current = f.accept;
        }
        if (max === Infinity) {                    // star tail: loop + skip
          const f = compileNode(node.node);
          current.eps.push(f.start);
          current.eps.push(t);                     // zero repetitions
          f.accept.eps.push(f.start);
          f.accept.eps.push(t);
        } else {                                   // bounded optionals
          let cur = current;
          for (let i = 0; i < max - min; i++) {
            const f = compileNode(node.node);
            cur.eps.push(f.start);
            cur.eps.push(t);
            f.accept.eps.push(t);
            cur = f.accept;
          }
          cur.eps.push(t);
        }
        return { start: s, accept: t };
      }
      default:
        throw new Error(`cannot compile node type '${node.type}'`);
    }
  }

  const main = compileNode(ast);
  main.accept.accept = true;

  const anchored = ast.type === 'concat' &&
    ast.parts[0]?.type === 'anchor' && ast.parts[0].kind === '^';
  const endAnchored = ast.type === 'concat' &&
    ast.parts[ast.parts.length - 1]?.type === 'anchor' && ast.parts[ast.parts.length - 1].kind === '$';

  const start = newState();
  start.eps.push(main.start);
  if (!anchored) {
    start.trans.push({ test: () => true, wildcard: true, label: '·', to: start }); // .* prefix
  }

  return { states: stateCounter, start, accept: main.accept, endAnchored };
}

/**
 * Linear-time NFA simulation: compute the epsilon/anchor closure once per
 * input position, then move across character edges. steps counts closure
 * work — the number the performance lab compares against the backtracker.
 */
export function nfaMatches(nfa, input) {
  let steps = 0;
  const len = input.length;

  const closure = (stateSet, pos) => {
    const stack = [...stateSet];
    const seen = new Set(stateSet);
    while (stack.length) {
      const s = stack.pop();
      steps++;
      for (const t of s.eps) if (!seen.has(t)) { seen.add(t); stack.push(t); }
      for (const tr of s.trans) {
        if (tr.anchorStart && pos === 0 && !seen.has(tr.to)) { seen.add(tr.to); stack.push(tr.to); }
        if (tr.anchorEnd && pos === len && !seen.has(tr.to)) { seen.add(tr.to); stack.push(tr.to); }
      }
    }
    return seen;
  };

  let current = closure(new Set([nfa.start]), 0);
  let accepted = [...current].some((s) => s.accept);
  for (let i = 0; i < len; i++) {
    const next = new Set();
    for (const s of current) {
      for (const tr of s.trans) {
        if (!tr.test) continue; // anchor edges are zero-width
        if (tr.wildcard || tr.test(input[i])) next.add(tr.to);
      }
    }
    current = closure(next, i + 1);
    if (current.size && [...current].some((s) => s.accept)) accepted = true;
    if (!current.size) return { matched: accepted, steps };
  }
  return { matched: accepted, steps };
}
