# Regexinator — Algorithms

How a pattern becomes a machine, three different ways, and why two of them
can never blow up. Everything here is implemented from scratch in `src/`.

## 1. Pipeline

```
            parse                    buildNfa                 buildDfa        minimize
/a(b|c)*/ ───────▶ AST ─────────────────▶ Thompson NFA ──────────▶ DFA ──────────▶ minimal DFA
                    │                                                                    │
                    └────────────────▶ naive backtracker (CPS)  ──── counted steps ─────┘
                                              (comparison oracle & catastrophe exhibit)
```

All three engines answer the same question — *does this input match?* — and
the test suite holds them to agreement on a curated matrix plus a
deterministic fuzz corpus.

## 2. Parsing

Recursive descent over the usual precedence ladder: alternation binds
loosest, then concatenation, then repetition, then atoms. The AST carries
`char`, `any`, `class` (range items, negation), `anchor` (`^`/`$`, allowed
only at the pattern edges), `concat`, `alt` and `repeat {min,max}` nodes.
Errors report the offending position — `[z-a]`, `a{3,1}` and a dangling `*`
are all rejected, not silently absorbed.

## 3. Thompson NFA construction

The classic construction: every fragment has exactly one start and one
accept state.

- `char/class/any`: one edge guarded by a predicate
- `concat`: wire `accept₁ --ε--> start₂`
- `alt`: fresh fan-out/fan-in states
- `E*`: skip edge `S --ε--> T` **plus** a loop `F.accept --ε--> F.start`
- `{n,m}`: n mandatory copies chained, then `m−n` optional copies, each
  with its own skip edge

Two details that actually matter:

- **Zero-repetition edges are easy to forget.** The first version of this
  engine matched `a*` against `""` with false because the skip edge
  `S --ε--> T` was missing. The fuzz-style tests exist to catch exactly
  this class of bug.
- **Anchors are zero-width guarded edges**, not characters: `^` edges may
  be crossed only while building position 0's closure, `$` edges only at
  end of input. The simulation's closure routine takes the position as a
  parameter for exactly this reason.

Matching runs the standard subset-per-character simulation: one closure per
input position, so the work is `O(states × n)` **regardless of the pattern**.

## 4. Subset construction → DFA

DFA states are *sets of NFA states*, keyed by the sorted state ids — the
canonical key gives `Map` deduplication for free. Transitions are computed
per alphabet symbol by moving every NFA state across that symbol and
closing again.

**The alphabet is interval-derived.** Class edges like `[a-c]` don't match
their label — they match a *range*. So breakpoints are collected from every
range endpoint and its successor, sorted, and one representative character
per adjacent interval becomes an alphabet symbol. Two characters in the
same interval behave identically for every edge, so the DFA is exact.

**The unanchored prefix loop becomes a default transition.** The `.*`
prefix is an NFA edge matching *anything*, which cannot be a single
alphabet entry. Instead, every DFA state whose subset contains the loop
records the loop's target as its `default` transition; the scanner falls
back to it when the input character has no explicit edge. This is the
classic "default transition" compression from the Dragon Book, minus the
formalism.

**End-anchored acceptance.** When the pattern ends with `$`, accept states
are reachable only through the guarded `$` edge, so the DFA marks them
`acceptAtEnd` and the scanner honours that flag only at the last position.

## 5. Minimization

Moore partition refinement: start from accepting vs non-accepting (with
`acceptAtEnd` as a third class so anchor semantics survive), repeatedly
regroup states by `(current group, transition signatures, default target)`
until the partition stops splitting. `(a|b)*abb` shrinks from 5 DFA states
to the textbook 4.

## 6. The backtracker, and why it exists

`src/backtracker.js` is a continuation-passing matcher: match a node, then
hand the remaining input to a continuation. Greedy quantifiers try the
iteration first. It is correct — the fuzz tests use it as the oracle — and
it is **catastrophically slow** on the right pattern:

```
pattern: (a|a)*b    input: aaaaaaaaaaaaaaaaaaaaaa (22 × a)

NFA           ~300 steps
DFA            ~24 steps
backtracker   >1,000,000 steps (doubles with every extra 'a')
```

The ambiguity `(a|a)` forces the backtracker to re-explore every partition
of the a-run; the automata never backtrack because they carry *all* live
alternatives through each position at once. The playground's lab tab makes
this concrete: press one button, watch the counters.

## 7. Testing strategy

1. **Curated matrix** — 27 pattern/input/expectation triples, all three
   engines asserted against the expectation *and* each other.
2. **Deterministic fuzz** — seeded PRNG generates random nested patterns
   and inputs; NFA and DFA must agree with the backtracker oracle on every
   case (blowups skip the oracle, never the automata).
3. **Shape tests** — parser AST structure, quantifier binding, error
   positions, minimization sizes.
4. **Scaling test** — DFA steps grow linearly on a 1000→4000 character
   pathological input.

## 8. Known dialect limits

Greedy/lazy distinction is irrelevant to membership and therefore
unimplemented; lookarounds and backreferences are out of scope (true
backreferences require the backtracking model — that's *why* real engines
keep it). `$`/`^` are accepted only at pattern edges. These limits are
features of the teaching scope, stated up front in the README.
