import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { filterEnclosures, availableValues, previewSplit, ENCLOSURE_FILTERS, PREVIEW_COUNT } from '../site/js/enclosure-filter.js';

const enc = (id, brand, mounting, modulesPerRow, rows) => ({ id, brand, mounting, modulesPerRow, rows });
const list = [
  enc('abb-1', 'abb', 'surface', 12, 1),
  enc('abb-2', 'abb', 'flush', 12, 2),
  enc('abb-4', 'abb', 'surface', 12, 4),
  enc('leg-18', 'legrand', 'surface', 18, 2),
  enc('leg-12', 'legrand', 'flush', 12, 1),
  enc('sch-13', 'schneider', 'surface', 13, 3),
];
const ALL = { brand: 'all', mounting: 'all', modulesPerRow: 'all', rowsCount: 'all' };
const ids = (arr) => arr.map((e) => e.id);
const sorted = (set) => [...set].sort();

describe('filterEnclosures', () => {
  test('без фильтров — все, в исходном порядке', () => {
    assert.deepEqual(ids(filterEnclosures(list, ALL)), ids(list));
  });

  test('все фильтры вместе', () => {
    assert.deepEqual(ids(filterEnclosures(list, { ...ALL, brand: 'abb', mounting: 'surface' })), ['abb-1', 'abb-4']);
    assert.deepEqual(ids(filterEnclosures(list, { ...ALL, modulesPerRow: 12, rowsCount: 1 })), ['abb-1', 'leg-12']);
    assert.deepEqual(ids(filterEnclosures(list, { ...ALL, brand: 'legrand', modulesPerRow: 13 })), []);
  });
});

describe('availableValues', () => {
  test('без фильтров доступно всё, что есть в каталоге', () => {
    assert.deepEqual(sorted(availableValues(list, ALL, 'modulesPerRow')), [12, 13, 18]);
    assert.deepEqual(sorted(availableValues(list, ALL, 'brand')), ['abb', 'legrand', 'schneider']);
  });

  test('выбран ABB — у модулей в ряду только 12, рядов 1, 2, 4', () => {
    const f = { ...ALL, brand: 'abb' };
    assert.deepEqual(sorted(availableValues(list, f, 'modulesPerRow')), [12]);
    assert.deepEqual(sorted(availableValues(list, f, 'rowsCount')), [1, 2, 4]);
    assert.deepEqual(sorted(availableValues(list, f, 'mounting')), ['flush', 'surface']);
  });

  test('свой фильтр не сужает собственные варианты: при ABB доступны и другие бренды', () => {
    assert.deepEqual(sorted(availableValues(list, { ...ALL, brand: 'abb' }, 'brand')), ['abb', 'legrand', 'schneider']);
  });

  test('выбрано 18 модулей — доступен только Legrand; вместе со встраиваемым — ни одного бренда', () => {
    assert.deepEqual(sorted(availableValues(list, { ...ALL, modulesPerRow: 18 }, 'brand')), ['legrand']);
    assert.deepEqual(sorted(availableValues(list, { ...ALL, modulesPerRow: 18, mounting: 'flush' }, 'brand')), []);
  });

  test('выбор только из доступных вариантов никогда не даёт пустой список', () => {
    // Перебираем случайные последовательности нажатий только по доступным вариантам
    let seed = 7;
    const random = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648) % n);
    for (let run = 0; run < 200; run++) {
      const filters = { ...ALL };
      for (let step = 0; step < 6; step++) {
        const keys = Object.keys(ENCLOSURE_FILTERS);
        const key = keys[random(keys.length)];
        const options = ['all', ...availableValues(list, filters, key)];
        filters[key] = options[random(options.length)];
        assert.ok(filterEnclosures(list, filters).length > 0, JSON.stringify(filters));
      }
    }
  });

  test('неизвестный фильтр — ошибка', () => {
    assert.throws(() => availableValues(list, ALL, 'color'));
  });
});

describe('previewSplit', () => {
  test('больше трёх — первые два и остальные в окне', () => {
    assert.equal(PREVIEW_COUNT, 2);
    const { shown, rest } = previewSplit(list);
    assert.deepEqual(ids(shown), ['abb-1', 'abb-2']);
    assert.deepEqual(ids(rest), ['abb-4', 'leg-18', 'leg-12', 'sch-13']);
    const four = previewSplit(list.slice(0, 4));
    assert.deepEqual([ids(four.shown), ids(four.rest)], [['abb-1', 'abb-2'], ['abb-4', 'leg-18']]);
  });

  test('три и меньше — все сразу, без окна (окно ради одного корпуса не нужно)', () => {
    const three = previewSplit(list.slice(0, 3));
    assert.deepEqual([ids(three.shown), three.rest], [['abb-1', 'abb-2', 'abb-4'], []]);
    assert.deepEqual(previewSplit(list.slice(0, 2)).rest, []);
    assert.deepEqual(previewSplit([]), { shown: [], rest: [] });
  });

  test('выбранный корпус — первым, если подходит под фильтры', () => {
    const { shown, rest } = previewSplit(list, PREVIEW_COUNT, 'sch-13');
    assert.deepEqual(ids(shown), ['sch-13', 'abb-1']);
    assert.deepEqual(ids(rest), ['abb-2', 'abb-4', 'leg-18', 'leg-12']);
    // Не подходит под фильтры (нет в списке) — порядок как есть
    assert.deepEqual(ids(previewSplit(list.slice(0, 5), PREVIEW_COUNT, 'sch-13').shown), ['abb-1', 'abb-2']);
    // Уже первый — без изменений; из трёх — все три, выбранный первым
    assert.deepEqual(ids(previewSplit(list, PREVIEW_COUNT, 'abb-1').shown), ['abb-1', 'abb-2']);
    assert.deepEqual(ids(previewSplit(list.slice(0, 3), PREVIEW_COUNT, 'abb-4').shown), ['abb-4', 'abb-1', 'abb-2']);
  });
});

describe('настоящий каталог', () => {
  test('ABB: только 12 модулей в ряду (13 и 18 недоступны)', async () => {
    const abb = JSON.parse(await readFile(new URL('../site/data/abb.json', import.meta.url), 'utf8'));
    assert.deepEqual(sorted(availableValues(abb.enclosures, { ...ALL, brand: 'abb' }, 'modulesPerRow')), [12]);
  });
});
