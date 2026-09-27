// regexinator — public API.

import { parse, dump, RegexParseError } from './parser.js';
import { buildNfa, nfaMatches } from './nfa.js';
import { buildDfa, minimize, dfaMatches } from './dfa.js';
import { backtrackMatches } from './backtracker.js';

export { parse, dump, RegexParseError };
export { buildNfa, nfaMatches };
export { buildDfa, minimize, dfaMatches };
export { backtrackMatches };

export const VERSION = '0.1.0';

/**
 * Compile a pattern once, query with every engine.
 * Returns { ast, nfa, dfa, minimized, test }.
 */
export function compile(pattern) {
  const ast = parse(pattern);
  const nfa = buildNfa(ast);
  const dfa = buildDfa(nfa);
  const minimized = minimize(dfa);

  return {
    ast,
    nfa,
    dfa,
    minimized,
    test: (input) => nfaMatches(nfa, input).matched,
    sizes: {
      nfaStates: nfa.states,
      dfaStates: dfa.states.length,
      minStates: minimized.states.length,
    },
  };
}

/**
 * Run the same pattern through all three engines and reconcile.
 * Used by the fuzz tests and by the playground's comparison view.
 */
export function compareEngines(pattern, input) {
  const compiled = compile(pattern);
  const nfa = nfaMatches(compiled.nfa, input);
  const dfa = dfaMatches(compiled.minimized, input);
  let back;
  try {
    back = backtrackMatches(compiled.ast, input, { stepLimit: 2_000_000 });
  } catch {
    back = { matched: null, steps: Infinity, blewUp: true };
  }
  return {
    pattern,
    input,
    nfa: nfa.matched,
    dfa: dfa.matched,
    backtracker: back.matched,
    steps: { nfa: nfa.steps, dfa: dfa.steps, backtracker: back.steps },
    agree: nfa.matched === dfa.matched && (back.matched === null || back.matched === nfa.matched),
  };
}
