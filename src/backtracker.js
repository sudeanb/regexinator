// Naive backtracking matcher — the baseline every regex textbook warns about.
//
// CPS over the AST: match(node, pos, k). Quantifiers recurse. Steps are
// counted so the performance lab can demonstrate catastrophic backtracking
// ((a|a)*b against "aaaa…a" goes exponential while the NFA/DFA stay linear).

export function backtrackMatches(ast, input, { stepLimit = 5_000_000 } = {}) {
  let steps = 0;

  const testChar = (node, ch) => {
    switch (node.type) {
      case 'char': return ch === node.ch;
      case 'any': return ch !== '\n';
      case 'class': {
        const hit = node.items.some((it) => ch >= it.lo && ch <= it.hi);
        return node.negated ? !hit : hit;
      }
      default: return false;
    }
  };

  function matchNode(node, pos, k) {
    if (steps++ > stepLimit) throw new Error('step limit exceeded');
    switch (node.type) {
      case 'empty': return k(pos);
      case 'anchor':
        if (node.kind === '$') return pos === input.length ? k(pos) : false;
        return k(pos); // '^': enforced by the anchored-start loop below
      case 'char': case 'any': case 'class':
        return pos < input.length && testChar(node, input[pos]) ? k(pos + 1) : false;
      case 'concat': {
        const parts = node.parts;
        const walk = (i, p) => {
          if (i === parts.length) return k(p);
          return matchNode(parts[i], p, (np) => walk(i + 1, np));
        };
        return walk(0, pos);
      }
      case 'alt': {
        for (const opt of node.opts) {
          const r = matchNode(opt, pos, k);
          if (r !== false) return r;
        }
        return false;
      }
      case 'repeat': {
        const { min, max } = node;
        const walk = (count, p) => {
          if (count >= min && k(p) !== false) return true;
          if (count >= max) return false;
          return matchNode(node.node, p, (np) => walk(count + 1, np));
          // no zero-width guard: (a?)* on "" is a legal empty iteration.
          // Runaway recursion is caught by the step limit instead — this
          // engine exists to demonstrate backtracking's failure modes.
        };
        return walk(0, pos);
      }
      default:
        throw new Error(`backtracker: unknown node ${node.type}`);
    }
  }

  // one full match attempt from position start; returns end position or false
  const attempt = (start) => matchNode(ast, start, (p) => p);

  // '$' at the end: only accept attempts that end at input length
  const hasEndAnchor = ast.type === 'concat' &&
    ast.parts[ast.parts.length - 1]?.type === 'anchor' && ast.parts[ast.parts.length - 1].kind === '$';
  const anchored = ast.type === 'concat' &&
    ast.parts[0]?.type === 'anchor' && ast.parts[0].kind === '^';

  for (let start = 0; start <= input.length; start++) {
    const end = attempt(start);
    if (end !== false && end !== undefined) {
      if (!hasEndAnchor || end === input.length) {
        return { matched: true, steps, start, end };
      }
    }
    if (anchored) break; // '^' only ever matches at position zero
  }
  return { matched: false, steps };
}
