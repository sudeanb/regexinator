import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parse, dump, RegexParseError } from '../src/parser.js';

test('parses alternation and concat structure', () => {
  const ast = parse('ab|c');
  assert.equal(ast.type, 'alt');
  assert.equal(ast.opts[0].type, 'concat');
  assert.equal(ast.opts[1].type, 'char');
});

test('quantifier binding: applies to the atom, not the concat', () => {
  const ast = parse('ab*');
  assert.equal(ast.type, 'concat');
  assert.equal(ast.parts[1].type, 'repeat');
  assert.equal(ast.parts[1].node.type, 'char');
});

test('counted quantifiers {n,m}', () => {
  const ast = parse('a{2,4}');
  assert.equal(ast.min, 2);
  assert.equal(ast.max, 4);
  const open = parse('a{2,}');
  assert.equal(open.max, Infinity);
});

test('character classes: ranges, negation, escapes inside', () => {
  const ast = parse('[a-c0-9\\d]');
  assert.equal(ast.type, 'class');
  assert.ok(ast.items.some((it) => it.lo === 'a' && it.hi === 'c'));
  assert.ok(ast.items.some((it) => it.lo === '0' && it.hi === '9'));
});

test('negated classes', () => {
  const ast = parse('[^ab]');
  assert.equal(ast.negated, true);
});

test('escape shorthands become classes', () => {
  const d = parse('\\d');
  assert.equal(d.type, 'class');
  assert.deepEqual(d.items, [{ lo: '0', hi: '9' }]);
  const w = parse('\\w');
  assert.ok(w.items.some((it) => it.lo === 'a' && it.hi === 'z'));
});

test('non-capturing groups behave like plain groups', () => {
  const a = parse('(ab)+');
  const b = parse('(?:ab)+');
  assert.equal(dump(a), dump(b));
});

test('anchors record their kind', () => {
  const ast = parse('^ab$');
  assert.equal(ast.parts[0].kind, '^');
  assert.equal(ast.parts[3].kind, '$');
});

test('rejects anchors anywhere but the pattern edges', () => {
  assert.throws(() => parse('a^b'), /only supported at the start/);
  assert.throws(() => parse('ab$m'), /only supported at the end/);
});

test('rejects dangling quantifier and out-of-order ranges', () => {
  assert.throws(() => parse('*a'), /nothing to repeat/);
  assert.throws(() => parse('[z-a]'), /out of order/);
  assert.throws(() => parse('a{3,1}'), /m < n/);
  assert.throws(() => parse('(ab'), /expected/);
});

test('dump produces a readable tree', () => {
  const text = dump(parse('a|b*'));
  assert.ok(text.includes('alt'));
  assert.ok(text.includes('repeat {0,∞}'));
});
