import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyStyle } from '../site/js/dom.js';

// Подставной CSSStyleDeclaration: обычные свойства — поля, CSS-переменные — только через setProperty
function fakeStyle() {
  const custom = {};
  return {
    custom,
    setProperty(name, value) {
      custom[name] = String(value);
    },
  };
}

test('CSS-переменные (--name) задаются через setProperty, обычные свойства — напрямую', () => {
  const style = fakeStyle();
  applyStyle(style, { '--cols': 36, '--modules': 18, gridColumn: 'span 2', width: '10px' });
  assert.deepEqual(style.custom, { '--cols': '36', '--modules': '18' });
  assert.equal(style.gridColumn, 'span 2');
  assert.equal(style.width, '10px');
  assert.equal(style['--cols'], undefined, 'CSS-переменная не должна оказаться обычным полем');
});

test('пустые значения пропускаются', () => {
  const style = fakeStyle();
  applyStyle(style, { '--a': null, width: undefined });
  assert.deepEqual(style.custom, {});
  assert.equal('width' in style, false);
});
