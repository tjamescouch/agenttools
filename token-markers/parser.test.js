#!/usr/bin/env node
/**
 * token-markers/parser.test.js
 *
 * Tests for the token marker parser, stripper, router, and stream processor.
 * Uses Node.js built-in assert — no dependencies.
 */

'use strict';

const assert = require('assert');
const { classify, parse, strip, createRouter, createStreamProcessor } = require('./parser');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

// ============================================================
console.log('\n--- classify ---');

test('state vector: single dimension', () => {
  const m = classify('anger:0.5');
  assert.strictEqual(m.type, 'state_vector');
  assert.deepStrictEqual(m.dimensions, { anger: 0.5 });
});

test('state vector: multiple dimensions', () => {
  const m = classify('anger:0.1,confidence:0.95,joy:0.8');
  assert.strictEqual(m.type, 'state_vector');
  assert.deepStrictEqual(m.dimensions, { anger: 0.1, confidence: 0.95, joy: 0.8 });
});

test('state vector: negative and zero values', () => {
  const m = classify('valence:-0.3,arousal:0.0');
  assert.strictEqual(m.type, 'state_vector');
  assert.deepStrictEqual(m.dimensions, { valence: -0.3, arousal: 0.0 });
});

test('state vector: values > 1.0', () => {
  const m = classify('energy:2.5');
  assert.strictEqual(m.type, 'state_vector');
  assert.deepStrictEqual(m.dimensions, { energy: 2.5 });
});

test('ctrl: command with value', () => {
  const m = classify('ctrl:tool_budget=3');
  assert.strictEqual(m.type, 'ctrl');
  assert.strictEqual(m.command, 'tool_budget');
  assert.strictEqual(m.value, '3');
});

test('ctrl: command without value', () => {
  const m = classify('ctrl:trim_context');
  assert.strictEqual(m.type, 'ctrl');
  assert.strictEqual(m.command, 'trim_context');
  assert.strictEqual(m.value, null);
});

test('ctrl: command with string value', () => {
  const m = classify('ctrl:pause=500');
  assert.strictEqual(m.type, 'ctrl');
  assert.strictEqual(m.command, 'pause');
  assert.strictEqual(m.value, '500');
});

test('ctrl: escalate (no args)', () => {
  const m = classify('ctrl:escalate');
  assert.strictEqual(m.type, 'ctrl');
  assert.strictEqual(m.command, 'escalate');
  assert.strictEqual(m.value, null);
});

test('ctrl: value with equals sign', () => {
  const m = classify('ctrl:set=key=value');
  assert.strictEqual(m.type, 'ctrl');
  assert.strictEqual(m.command, 'set');
  assert.strictEqual(m.value, 'key=value');
});

test('mem: numeric id', () => {
  const m = classify('mem:12342');
  assert.strictEqual(m.type, 'mem');
  assert.strictEqual(m.id, '12342');
});

test('mem: hex id (lucidity format)', () => {
  const m = classify('mem:03ea8d6496deaa2d');
  assert.strictEqual(m.type, 'mem');
  assert.strictEqual(m.id, '03ea8d6496deaa2d');
});

test('mem: short hex id', () => {
  const m = classify('mem:8bc17fbc');
  assert.strictEqual(m.type, 'mem');
  assert.strictEqual(m.id, '8bc17fbc');
});

test('mem: uppercase hex', () => {
  const m = classify('mem:ABCDEF01');
  assert.strictEqual(m.type, 'mem');
  assert.strictEqual(m.id, 'ABCDEF01');
});

test('unknown: plain text', () => {
  const m = classify('just some text');
  assert.strictEqual(m.type, 'unknown');
});

test('unknown: no colon, no floats', () => {
  const m = classify('hello world');
  assert.strictEqual(m.type, 'unknown');
});

test('raw field preserved', () => {
  const m = classify('anger:0.5');
  assert.strictEqual(m.raw, '@@anger:0.5@@');
});

// ============================================================
console.log('\n--- parse ---');

test('parse: no markers', () => {
  const markers = parse('Hello world, no markers here.');
  assert.strictEqual(markers.length, 0);
});

test('parse: single state vector', () => {
  const markers = parse('I feel @@joy:0.9@@ great');
  assert.strictEqual(markers.length, 1);
  assert.strictEqual(markers[0].type, 'state_vector');
  assert.deepStrictEqual(markers[0].dimensions, { joy: 0.9 });
});

test('parse: multiple markers', () => {
  const markers = parse('@@anger:0.1,confidence:0.95@@ text @@ctrl:pause=500@@ more @@mem:12342@@');
  assert.strictEqual(markers.length, 3);
  assert.strictEqual(markers[0].type, 'state_vector');
  assert.strictEqual(markers[1].type, 'ctrl');
  assert.strictEqual(markers[2].type, 'mem');
});

test('parse: mixed valid and unknown', () => {
  const markers = parse('@@joy:0.5@@ @@gibberish@@ @@ctrl:escalate@@');
  assert.strictEqual(markers.length, 3);
  assert.strictEqual(markers[0].type, 'state_vector');
  assert.strictEqual(markers[1].type, 'unknown');
  assert.strictEqual(markers[2].type, 'ctrl');
});

test('parse: spec example - state vector in prose', () => {
  const markers = parse('I am god, king of kings @@anger:0.1,confidence:0.95,reverence:0.8@@ and lord of lords');
  assert.strictEqual(markers.length, 1);
  assert.strictEqual(markers[0].type, 'state_vector');
  assert.deepStrictEqual(markers[0].dimensions, { anger: 0.1, confidence: 0.95, reverence: 0.8 });
});

test('parse: spec example - mem refs in prose', () => {
  const markers = parse('I am god, king of kings and @@mem:12342@@ lord of lords @@mem:983244@@');
  assert.strictEqual(markers.length, 2);
  assert.strictEqual(markers[0].type, 'mem');
  assert.strictEqual(markers[0].id, '12342');
  assert.strictEqual(markers[1].id, '983244');
});

test('parse: empty markers ignored', () => {
  const markers = parse('Hello @@@@ world');
  assert.strictEqual(markers.length, 0);
});

test('parse: adjacent markers', () => {
  const markers = parse('@@joy:1.0@@@@ctrl:escalate@@');
  assert.strictEqual(markers.length, 2);
  assert.strictEqual(markers[0].type, 'state_vector');
  assert.strictEqual(markers[1].type, 'ctrl');
});

// ============================================================
console.log('\n--- strip ---');

test('strip: no markers', () => {
  assert.strictEqual(strip('Hello world'), 'Hello world');
});

test('strip: single marker', () => {
  assert.strictEqual(strip('Hello @@joy:0.9@@ world'), 'Hello  world');
});

test('strip: multiple markers', () => {
  assert.strictEqual(
    strip('@@anger:0.1@@ text @@ctrl:pause=500@@ more @@mem:12342@@'),
    ' text  more '
  );
});

test('strip: marker at start and end', () => {
  assert.strictEqual(strip('@@ctrl:escalate@@hello@@mem:123@@'), 'hello');
});

test('strip: empty markers stripped', () => {
  assert.strictEqual(strip('hello @@@@ world'), 'hello  world');
});

test('strip: unknown/invalid markers still stripped', () => {
  assert.strictEqual(strip('before @@invalid garbage@@ after'), 'before  after');
});

test('strip: aggressive — all @@ patterns removed', () => {
  assert.strictEqual(strip('@@anything at all@@'), '');
});

// ============================================================
console.log('\n--- createRouter ---');

test('router: dispatches state vectors', () => {
  let received = null;
  const route = createRouter({
    state_vector: (m) => { received = m; },
  });
  const clean = route('Hello @@joy:0.9@@ world');
  assert.strictEqual(clean, 'Hello  world');
  assert.notStrictEqual(received, null);
  assert.strictEqual(received.type, 'state_vector');
  assert.deepStrictEqual(received.dimensions, { joy: 0.9 });
});

test('router: dispatches ctrl', () => {
  let received = null;
  const route = createRouter({
    ctrl: (m) => { received = m; },
  });
  route('@@ctrl:tool_budget=5@@');
  assert.notStrictEqual(received, null);
  assert.strictEqual(received.command, 'tool_budget');
  assert.strictEqual(received.value, '5');
});

test('router: dispatches mem', () => {
  let received = null;
  const route = createRouter({
    mem: (m) => { received = m; },
  });
  route('@@mem:03ea8d6496deaa2d@@');
  assert.notStrictEqual(received, null);
  assert.strictEqual(received.id, '03ea8d6496deaa2d');
});

test('router: dispatches multiple types', () => {
  const received = [];
  const route = createRouter({
    state_vector: (m) => received.push(m.type),
    ctrl: (m) => received.push(m.type),
    mem: (m) => received.push(m.type),
  });
  route('@@joy:0.5@@ @@ctrl:escalate@@ @@mem:abc123@@');
  assert.deepStrictEqual(received, ['state_vector', 'ctrl', 'mem']);
});

test('router: handler errors do not break processing', () => {
  const received = [];
  const route = createRouter({
    state_vector: () => { throw new Error('boom'); },
    ctrl: (m) => received.push(m.type),
  });
  // Should not throw
  const clean = route('@@joy:0.5@@ @@ctrl:escalate@@');
  assert.strictEqual(clean, ' ');
  assert.deepStrictEqual(received, ['ctrl']);
});

test('router: no handlers — just strips', () => {
  const route = createRouter();
  const clean = route('Hello @@joy:0.5@@ world');
  assert.strictEqual(clean, 'Hello  world');
});

// ============================================================
console.log('\n--- createStreamProcessor ---');

test('stream: simple complete chunk', () => {
  let output = '';
  const stateVecs = [];
  const proc = createStreamProcessor(
    { state_vector: (m) => stateVecs.push(m) },
    (text) => { output += text; }
  );
  proc.push('Hello @@joy:0.9@@ world');
  proc.flush();
  assert.strictEqual(output, 'Hello  world');
  assert.strictEqual(stateVecs.length, 1);
});

test('stream: marker split across chunks', () => {
  let output = '';
  const mems = [];
  const proc = createStreamProcessor(
    { mem: (m) => mems.push(m) },
    (text) => { output += text; }
  );
  proc.push('Hello @@mem:');
  proc.push('12345@@ world');
  proc.flush();
  assert.strictEqual(output, 'Hello  world');
  assert.strictEqual(mems.length, 1);
  assert.strictEqual(mems[0].id, '12345');
});

test('stream: multiple chunks no markers', () => {
  let output = '';
  const proc = createStreamProcessor({}, (text) => { output += text; });
  proc.push('Hello ');
  proc.push('world');
  proc.flush();
  assert.strictEqual(output, 'Hello world');
});

test('stream: flush incomplete marker as text', () => {
  let output = '';
  const proc = createStreamProcessor({}, (text) => { output += text; });
  proc.push('Hello @@incomplete');
  proc.flush();
  // Incomplete marker gets flushed as-is (strip won't match without closing @@)
  assert.ok(output.includes('Hello'));
});

// ============================================================
// Summary

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
