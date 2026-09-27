# ⟨R⟩ Regexinator

**One regex, three engines, built from scratch: Thompson NFA, subset-constructed
DFA with minimization, and a naive backtracker — plus an interactive automaton
visualizer and a catastrophic-backtracking lab. Zero dependencies.**

[![CI](https://github.com/sudeanb/regexinator/actions/workflows/ci.yml/badge.svg)](https://github.com/sudeanb/regexinator/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-green)](package.json)

▶ **[See your pattern as a machine →](https://sudeanb.github.io/regexinator/)**
(type a pattern, watch the NFA/DFA graph, compare step counters)

## Why three engines

Because they answer the same question with wildly different costs — and
seeing that is the lesson:

```
pattern: (a|a)*b    input: aaaaaaaaaaaaaaaaaaaaaa (22 × a)

NFA            ~300 steps     (all live alternatives carried at once)
DFA             ~24 steps     (one transition per character, forever)
backtracker  >1,000,000      (re-exploring every partition — doubles per 'a')
```

The backtracker is not a toy mistake; it is the **oracle** the other two are
tested against, and the exhibit the performance lab dissects. Real engines
keep backtracking for one reason — backreferences — which is exactly why
RE2-style automata can't express them. This project makes that trade-off
runnable in a browser tab.

## What's implemented

| Stage | Highlights |
|---|---|
| **Parser** | recursive descent, classes/ranges/negation, `{n,m}`, escape shorthands, anchors at pattern edges only, position-precise errors |
| **Thompson NFA** | ε-edges, `*` loop+skip, anchored `^`/`$` as position-gated zero-width edges, linear-time simulation |
| **DFA** | subset construction with canonical state keys, **interval-derived alphabet** (one representative per character-class boundary), default transitions for the unanchored prefix, Moore minimization |
| **Backtracker** | CPS matcher with a step counter — the oracle and the exhibit |
| **Visualizer** | SVG graphs of NFA/DFA/minimized with ε-edges, accept rings, start markers; match highlighting; step bar charts |
| **Tests** | 27-case curated matrix + deterministic fuzz corpus (NFA ≡ DFA ≡ oracle) + blowup quantification; 16 tests, `node --test` |

## Quick start

```bash
git clone https://github.com/sudeanb/regexinator.git
cd regexinator
node --test          # 16 tests, zero dependencies
```

…or open the deployed playground and type `(a|b)*abb`.

## Patterns that teach

`patterns/patterns.json` includes both honest patterns (email-ish, hex
color, IPv4 octets) and the famous pathological ones — `(a|a)*b`,
`(a+)+b` — one click from the lab.

## Design decisions worth reading about

[docs/ALGORITHMS.md](docs/ALGORITHMS.md) covers the full pipeline, but two
bugs found *while building this* shaped the code:

- the missing **zero-repetition edge** (`a*` failed on `""`) — the kind of
  bug only a fuzz corpus catches
- the **counter-reset trap** of the backtracker's zero-width guard, where
  a "safety check" silently rejected legal empty iterations of `(c?)`;
  the guard was removed in favour of the explicit step limit

## Limitations (honest list)

- no lookarounds or backreferences (backreferences are precisely what
  forces real engines to keep backtracking — documented, in scope for a
  future "part 2")
- greedy/lazy is unimplemented: membership semantics don't care
- `^`/`$` only at pattern edges

## License

[MIT](LICENSE)
