'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createPreference, key } = require('../public/theme-preference');
function fixture(saved, denied = false) {
  const rendered = [], writes = [], system = new EventTarget(); system.matches = false;
  const preference = createPreference({ read: () => { if (denied) throw Error('denied'); return saved; },
    write: (...value) => { if (denied) throw Error('denied'); writes.push(value); }, system, apply: theme => rendered.push(theme) });
  return { preference, rendered, writes, system };
}
test('appearance restores only known presets before first paint and keeps instances independent', () => {
  const first = fixture('dark'), second = fixture('paper'); assert.deepEqual(first.rendered, ['dark']); assert.equal(second.preference.value, 'paper');
  for (const value of [null, '', 'invalid', '<script>']) assert.equal(fixture(value).preference.value, 'forest');
  assert.throws(() => first.preference.set('invalid'), /未知/); assert.equal(first.preference.value, 'dark'); assert.equal(first.writes.length, 0);
});
test('system appearance follows live OS changes while explicit selections remain stable', () => {
  const f = fixture('system'); assert.equal(f.preference.resolved, 'forest');
  f.system.matches = true; f.system.dispatchEvent(new Event('change')); assert.equal(f.preference.resolved, 'dark');
  f.preference.set('blue'); f.system.matches = false; f.system.dispatchEvent(new Event('change')); assert.equal(f.rendered.at(-1), 'blue');
  assert.deepEqual(f.writes, [[key, 'blue']]);
});
test('unavailable browser storage still allows switching and unsubscribe removes callbacks', () => {
  const f = fixture('dark', true); let calls = 0; const off = f.preference.subscribe(() => calls++);
  assert.equal(f.preference.stored, false); f.preference.set('dark'); assert.equal(f.preference.resolved, 'dark'); assert.equal(calls, 1);
  off(); f.preference.set('paper'); assert.equal(calls, 1); assert.equal(f.rendered.at(-1), 'paper');
});
