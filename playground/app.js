// Regexinator playground — automaton visualization + engine comparison lab.

import { parse, RegexParseError } from '../src/parser.js';
import { buildNfa } from '../src/nfa.js';
import { buildDfa, minimize, dfaMatches } from '../src/dfa.js';
import { nfaMatches } from '../src/nfa.js';
import { backtrackMatches } from '../src/backtracker.js';

const patternEl = document.getElementById('pattern');
const inputEl = document.getElementById('input');
const machineEl = document.getElementById('machine');
const verdictEl = document.getElementById('verdict');
const viz = document.getElementById('viz');
const sizesEl = document.getElementById('sizes');
const stepsEl = document.getElementById('steps');
const matchEl = document.getElementById('matchline');
const catOut = document.getElementById('catout');

let compiled = null;
let nfaObj = null, dfaObj = null, minObj = null;

// ---------- automaton extraction ----------

function automatonEdges(machine, isDfa) {
  // returns { nodes: [{id, x, y, accept, acceptAtEnd}], edges: [{from, to, label, eps, wildcard}] }
  const nodes = new Map();
  const edges = [];
  const start = isDfa ? machine.start : machine.start;

  // BFS for depth layout
  const depth = new Map();
  const queue = [[start, 0]];
  depth.set(start, 0);
  nodes.set(start, { accept: isDfa ? machine.states[start].accept : machine.start.accept });
  let guard = 0;
  while (queue.length && guard++ < 5000) {
    const [id, d] = queue.shift();
    const s = isDfa ? machine.states[id] : id;
    if (isDfa) {
      for (const [label, to] of s.trans) {
        edges.push({ from: id, to, label, eps: false });
        if (!nodes.has(to)) { nodes.set(to, { accept: machine.states[to].accept }); depth.set(to, d + 1); queue.push([to, d + 1]); }
      }
      if (s.default !== undefined && !nodes.has(s.default)) {
        edges.push({ from: id, to: s.default, label: 'else', eps: true });
        nodes.set(s.default, { accept: machine.states[s.default].accept });
        depth.set(s.default, d + 1); queue.push([s.default, d + 1]);
      }
    } else {
      for (const t of s.eps) {
        edges.push({ from: id, to: t, label: '', eps: true });
        if (!nodes.has(t)) { nodes.set(t, { accept: t.accept }); depth.set(t, d + 1); queue.push([t, d + 1]); }
      }
      for (const tr of s.trans) {
        edges.push({ from: id, to: tr.to, label: tr.anchorStart ? '^' : tr.anchorEnd ? '$' : tr.label, eps: false, wildcard: !!tr.wildcard });
        if (!nodes.has(tr.to)) { nodes.set(tr.to, { accept: tr.to.accept }); depth.set(tr.to, d + 1); queue.push([tr.to, d + 1]); }
      }
    }
  }

  // layout: x by depth, y by insertion order within depth
  const byDepth = new Map();
  let order = 0;
  for (const id of nodes.keys()) {
    const d = depth.get(id) ?? 0;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d).push(id);
  }
  for (const [d, ids] of byDepth) {
    ids.forEach((id, i) => {
      const n = nodes.get(id);
      n.x = 60 + d * 130;
      n.y = 40 + i * 64 + (d % 2) * 18;
      n.id = id;
      n.label = isDfa ? 'q' + id : 's' + id;
    });
  }
  if (!nodes.has(start)) nodes.set(start, { x: 60, y: 60, id: start, label: 'start' });
  return { nodes: [...nodes.values()], edges, start };
}

// ---------- SVG rendering ----------

function renderAutomaton() {
  const kind = machineEl.value;
  const machine = kind === 'nfa' ? nfaObj : kind === 'dfa' ? dfaObj : minObj;
  const isDfa = kind !== 'nfa';
  const { nodes, edges, start } = automatonEdges(machine, isDfa);

  const W = Math.max(viz.clientWidth, 300);
  const H = Math.max(60 + Math.max(...nodes.map((n) => n.y), 0), viz.clientHeight, 200);
  viz.setAttribute('viewBox', `0 0 ${W} ${H}`);
  viz.setAttribute('width', W);
  viz.setAttribute('height', H);
  viz.innerHTML = '';

  const NS = 'http://www.w3.org/2000/svg';
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const defs = document.createElementNS(NS, 'defs');
  defs.innerHTML = `<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5"
      markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#7d8899"></path></marker>`;
  viz.appendChild(defs);

  for (const e of edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) continue;
    if (a === b) {
      const c = document.createElementNS(NS, 'path');
      c.setAttribute('d', `M ${a.x + 14} ${a.y - 8} C ${a.x + 40} ${a.y - 40}, ${a.x - 40} ${a.y - 40}, ${a.x - 14} ${a.y - 8}`);
      c.setAttribute('fill', 'none');
      c.setAttribute('stroke', e.eps ? '#4a5568' : '#5aa2f7');
      c.setAttribute('stroke-dasharray', e.eps ? '4 3' : 'none');
      c.setAttribute('marker-end', 'url(#arrow)');
      viz.appendChild(c);
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', a.x); t.setAttribute('y', a.y - 34);
      t.setAttribute('fill', '#7d8899'); t.setAttribute('font-size', '10');
      t.setAttribute('text-anchor', 'middle');
      t.textContent = e.label || 'ε';
      viz.appendChild(t);
      continue;
    }
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', a.x); l.setAttribute('y1', a.y);
    l.setAttribute('x2', b.x); l.setAttribute('y2', b.y);
    l.setAttribute('stroke', e.eps ? '#4a5568' : '#5aa2f7');
    l.setAttribute('stroke-width', '1.2');
    l.setAttribute('stroke-dasharray', e.eps ? '4 3' : 'none');
    l.setAttribute('marker-end', 'url(#arrow)');
    viz.appendChild(l);
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', (a.x + b.x) / 2); t.setAttribute('y', (a.y + b.y) / 2 - 4);
    t.setAttribute('fill', e.eps ? '#4a5568' : '#8fb8f5');
    t.setAttribute('font-size', '11');
    t.setAttribute('text-anchor', 'middle');
    t.textContent = e.label ? (e.wildcard ? 'any' : e.label) : 'ε';
    viz.appendChild(t);
  }

  for (const n of nodes) {
    const g = document.createElementNS(NS, 'g');
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', n.x); c.setAttribute('cy', n.y); c.setAttribute('r', 14);
    c.setAttribute('fill', n.accept ? '#1d3a2f' : '#141b28');
    c.setAttribute('stroke', n.id === start ? '#e5b567' : n.accept ? '#46c98b' : '#5a6478');
    c.setAttribute('stroke-width', n.id === start || n.accept ? '2' : '1.2');
    if (n.accept) {
      const inner = document.createElementNS(NS, 'circle');
      inner.setAttribute('cx', n.x); inner.setAttribute('cy', n.y); inner.setAttribute('r', 10);
      inner.setAttribute('fill', 'none'); inner.setAttribute('stroke', '#46c98b');
      g.appendChild(inner);
    }
    g.appendChild(c);
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', n.x); t.setAttribute('y', n.y + 3.5);
    t.setAttribute('fill', '#aab6c8'); t.setAttribute('font-size', '10');
    t.setAttribute('text-anchor', 'middle');
    t.textContent = n.label;
    g.appendChild(t);
    viz.appendChild(g);
  }
}

// ---------- matching + panels ----------

function update() {
  const pattern = patternEl.value;
  const input = inputEl.value;
  try {
    compiled = compileAll(pattern);
    nfaObj = compiled.nfa; dfaObj = compiled.dfa; minObj = compiled.minimized;
    verdictEl.className = 'verdict yes';
    verdictEl.textContent = `✓ compiled — ${compiled.sizes.nfaStates} NFA → ${compiled.sizes.dfaStates} DFA → ${compiled.sizes.minStates} min states`;
  } catch (err) {
    verdictEl.className = 'verdict no';
    verdictEl.textContent = err.message;
    return;
  }

  const nfaR = nfaMatches(nfaObj, input);
  const dfaR = dfaMatches(minObj, input);
  let backR;
  try {
    backR = backtrackMatches(compiled.ast, input, { stepLimit: 2_000_000 });
  } catch {
    backR = { matched: false, steps: Infinity };
  }
  const matched = nfaR.matched;

  verdictEl.textContent += ` — ${matched ? 'MATCH' : 'no match'}`;

  // highlighted first backtracker match
  if (backR.matched && backR.end !== undefined) {
    matchEl.innerHTML =
      escapeHtml(input.slice(0, backR.start)) +
      '<mark>' + escapeHtml(input.slice(backR.start, backR.end)) + '</mark>' +
      escapeHtml(input.slice(backR.end));
  } else {
    matchEl.textContent = input || '(empty)';
  }

  sizesEl.textContent = `states — NFA: ${compiled.sizes.nfaStates} · DFA: ${compiled.sizes.dfaStates} · minimized: ${compiled.sizes.minStates}`;

  const maxSteps = Math.max(nfaR.steps, dfaR.steps, Math.min(backR.steps, 2_000_000), 1);
  const row = (label, steps, danger) => {
    const shown = steps > 2_000_000 ? '>2M' : steps;
    const w = danger ? Math.min(100, (steps / 2_000_000) * 100 + 4) : Math.max(2, (steps / maxSteps) * 100);
    return `<div class="bar-row ${danger ? 'b' : ''}"><span class="lbl">${label}</span>` +
      `<span class="bar" style="width:${w}%"></span><span>${shown}</span></div>`;
  };
  stepsEl.innerHTML =
    row('NFA', nfaR.steps) +
    row('DFA min', dfaR.steps) +
    row('backtracker', backR.steps, backR.steps > 50_000);
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function compileAll(pattern) {
  const ast = parse(pattern);
  const nfa = buildNfa(ast);
  const dfa = buildDfa(nfa);
  const minimized = minimize(dfa);
  return { ast, nfa, dfa, minimized, sizes: { nfaStates: nfa.states, dfaStates: dfa.states.length, minStates: minimized.states.length } };
}

// ---------- catastrophic lab ----------

document.getElementById('cat').addEventListener('click', () => {
  patternEl.value = '(a|a)*b';
  inputEl.value = 'a'.repeat(24);
  update();
  const input = inputEl.value;
  const ast = parse(patternEl.value);
  const nfa = buildNfa(ast);
  const dfa = minimize(buildDfa(nfa));
  const nfaSteps = nfaMatches(nfa, input).steps;
  const dfaSteps = dfaMatches(dfa, input).steps;
  let backSteps = 'limit';
  const t0 = performance.now();
  try {
    backSteps = backtrackMatches(ast, input, { stepLimit: 2_000_000 }).steps;
  } catch { /* blowup — the point */ }
  const ms = (performance.now() - t0).toFixed(0);
  catOut.innerHTML =
    `<table><tr><th>engine</th><th>steps</th></tr>` +
    `<tr><td>NFA</td><td>${nfaSteps}</td></tr>` +
    `<tr><td>DFA</td><td>${dfaSteps}</td></tr>` +
    `<tr><td>backtracker</td><td>${backSteps} (${ms} ms)</td></tr></table>` +
    `<div class="sizes">+1 'a' doubles the backtracker's work; the DFA never notices.</div>`;
  update();
});

// ---------- wiring ----------

patternEl.addEventListener('input', update);
inputEl.addEventListener('input', update);
machineEl.addEventListener('change', renderAutomaton);
addEventListener('resize', renderAutomaton);

update();
renderAutomaton();
