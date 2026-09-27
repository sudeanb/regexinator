// Regexinator parser — regex source → AST.
//
// Supported syntax (documented subset):
//   literals, '.', escapes (\d \D \w \W \s \S and literal escapes)
//   classes [abc], [a-z], negation [^...]
//   anchors ^ (start of pattern), $ (end of pattern)
//   groups (…), non-capturing (?:…), alternation a|b
//   quantifiers * + ? {n} {n,} {n,m}  (greedy — irrelevant for membership)
//
// Everything else is a parse error with position — this is a teaching
// engine, silent mis-parses would be worse than a small dialect.

export class RegexParseError extends Error {
  constructor(message, pos) {
    super(`${message} (position ${pos})`);
    this.pos = pos;
  }
}

const ESCAPE_CLASSES = {
  d: [{ lo: '0', hi: '9' }],
  w: [{ lo: '0', hi: '9' }, { lo: 'A', hi: 'Z' }, { lo: 'a', hi: 'z' }, { lo: '_', hi: '_' }],
  s: [{ lo: '\t', hi: '\n' }, { lo: '\v', hi: '\r' }, { lo: ' ', hi: ' ' }],
};

export function parse(source) {
  let pos = 0;

  const peek = () => source[pos];
  const eat = (ch) => { if (source[pos] === ch) { pos++; return true; } return false; };
  const expect = (ch) => {
    if (!eat(ch)) throw new RegexParseError(`expected '${ch}'`, pos);
  };

  function parseAlt() {
    const opts = [parseConcat()];
    while (peek() === '|') { pos++; opts.push(parseConcat()); }
    return opts.length === 1 ? opts[0] : { type: 'alt', opts };
  }

  function parseConcat() {
    const parts = [];
    while (pos < source.length && peek() !== '|' && peek() !== ')') {
      parts.push(parseRepeat());
    }
    if (parts.length === 0) return { type: 'empty' };
    return parts.length === 1 ? parts[0] : { type: 'concat', parts };
  }

  function parseRepeat() {
    const atom = parseAtom();
    const c = peek();
    if (c === '*') { pos++; return { type: 'repeat', min: 0, max: Infinity, node: atom }; }
    if (c === '+') { pos++; return { type: 'repeat', min: 1, max: Infinity, node: atom }; }
    if (c === '?') { pos++; return { type: 'repeat', min: 0, max: 1, node: atom }; }
    if (c === '{') {
      const save = pos;
      pos++;
      let digits = '';
      while (/[0-9]/.test(peek() ?? '')) digits += source[pos++];
      if (!digits) { pos = save; return atom; }
      const min = Number(digits);
      let max = min;
      if (eat(',')) {
        let d2 = '';
        while (/[0-9]/.test(peek() ?? '')) d2 += source[pos++];
        max = d2 ? Number(d2) : Infinity;
      }
      expect('}');
      if (max < min) throw new RegexParseError('quantifier {n,m} with m < n', save);
      return { type: 'repeat', min, max, node: atom };
    }
    return atom;
  }

  function parseAtom() {
    const c = peek();
    if (c === '(') {
      pos++;
      eat('?'); eat(':'); // (?: — treated like ( ; we never build capture groups
      const node = parseAlt();
      expect(')');
      return node;
    }
    if (c === '[') return parseClass();
    if (c === '.') { pos++; return { type: 'any' }; }
    if (c === '^') {
      if (pos !== 0) throw new RegexParseError("'^' is only supported at the start of the pattern", pos);
      pos++;
      return { type: 'anchor', kind: '^' };
    }
    if (c === '$') {
      if (pos !== source.length - 1) throw new RegexParseError("'$' is only supported at the end of the pattern", pos);
      pos++;
      return { type: 'anchor', kind: '$' };
    }
    if (c === '\\') return parseEscape();
    if (c === '*' || c === '+' || c === '?') {
      throw new RegexParseError(`quantifier '${c}' has nothing to repeat`, pos);
    }
    pos++;
    return { type: 'char', ch: c };
  }

  function parseEscape() {
    const escapePos = pos;
    pos++;
    const e = peek();
    if (e === undefined) throw new RegexParseError('dangling escape', escapePos);
    pos++;
    if (ESCAPE_CLASSES[e]) {
      const negated = e === e.toUpperCase() && ['D', 'W', 'S'].includes(e);
      return { type: 'class', negated, items: ESCAPE_CLASSES[e.toLowerCase()] };
    }
    return { type: 'char', ch: e };
  }

  function parseClass() {
    const start = pos;
    pos++; // [
    let negated = false;
    if (peek() === '^') { negated = true; pos++; }
    const items = [];
    let first = true;
    while (pos < source.length && (peek() !== ']' || first)) {
      first = false;
      let lo = peek();
      if (lo === '\\') {
        pos++;
        const e = peek();
        if (ESCAPE_CLASSES[e] && !negated) {
          // shorthand classes inside [...] are allowed but cannot mix with
          // negation of the whole class beyond the usual meaning
          items.push(...ESCAPE_CLASSES[e]);
          pos++;
          continue;
        }
        lo = ESCAPE_CLASSES[e.toLowerCase()] ? e : e; // \d inside class → keep simple: literal e
        if ('dws'.includes(e)) {
          items.push(...ESCAPE_CLASSES[e]);
          pos++;
          continue;
        }
      }
      pos++;
      if (peek() === '-' && source[pos + 1] !== ']' && source[pos + 1] !== undefined) {
        pos++;
        let hi = peek();
        if (hi === '\\') { pos++; hi = peek(); }
        pos++;
        if (hi < lo) throw new RegexParseError(`class range out of order: ${lo}-${hi}`, start);
        items.push({ lo, hi });
      } else {
        items.push({ lo, hi: lo });
      }
    }
    expect(']');
    return { type: 'class', negated, items };
  }

  const ast = parseAlt();
  if (pos < source.length) throw new RegexParseError(`unexpected '${peek()}'`, pos);
  return ast;
}

/** Human-readable AST dump (used by tests and the playground). */
export function dump(node, indent = '') {
  switch (node.type) {
    case 'char': return `${indent}char '${node.ch}'`;
    case 'any': return `${indent}any`;
    case 'empty': return `${indent}empty`;
    case 'anchor': return `${indent}anchor ${node.kind}`;
    case 'class':
      return `${indent}class${node.negated ? ' ^' : ''} ` +
        node.items.map((it) => (it.lo === it.hi ? it.lo : `${it.lo}-${it.hi}`)).join(' ');
    case 'concat':
      return [`${indent}concat`, ...node.parts.map((p) => dump(p, indent + '  '))].join('\n');
    case 'alt':
      return [`${indent}alt`, ...node.opts.map((p) => dump(p, indent + '  '))].join('\n');
    case 'repeat':
      return [`${indent}repeat {${node.min},${node.max === Infinity ? '∞' : node.max}}`,
        dump(node.node, indent + '  ')].join('\n');
    default:
      return `${indent}?${node.type}`;
  }
}
