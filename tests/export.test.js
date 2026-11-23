import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { specTable, toCsv, csvSeparator, exportFileName, terminalsSpec, clampsText, combsSpec, combName, combPartsSpec, combPartName, SPEC_COLUMNS } from '../site/js/export.js';
import { createBoard, addDevice, indexById } from '../site/js/board.js';
import { createTranslator } from '../site/js/i18n.js';

const messages = (lang) => readFile(new URL(`../site/i18n/${lang}.json`, import.meta.url), 'utf8').then(JSON.parse);
const ru = await messages('ru');
const tRu = createTranslator(ru, ru, 'ru');
const tEn = createTranslator(await messages('en'), ru, 'en');

const enclosure = {
  id: 'hager-va24b',
  brand: 'hager',
  series: 'Volta',
  article: 'VA24B',
  mounting: 'surface',
  rows: 2,
  modulesPerRow: 12,
  door: 'none',
  ipRating: 30,
  verified: true,
};
const devices = indexById([
  { id: 'mcb', brand: 'hager', article: 'MCN116', category: 'mcb', modules: 1, verified: true, specs: { poles: '1P', ratedCurrentA: 16, curve: 'C', breakingCapacityKa: 6 } },
  { id: 'rcd', brand: 'abb', article: '2CSF202004R1400', model: 'F202 A-40/0.03', category: 'rcd', modules: 2, verified: false, specs: { poles: '2P', ratedCurrentA: 40, sensitivityMa: 30, rcdType: 'A' } },
  { id: 'spd', brand: 'hager', article: 'SPN215', category: 'spd', modules: 1.5, verified: true, specs: { poles: '1P+N', spdType: '2' } },
]);
const brandNames = new Map([
  ['hager', 'Hager'],
  ['abb', 'ABB'],
]);

function build(ids) {
  let board = createBoard(enclosure);
  for (const id of ids) ({ board } = addDevice(board, enclosure, devices, id));
  return board;
}

describe('specTable', () => {
  const table = specTable(build(['rcd', 'mcb', 'mcb', 'spd']), enclosure, devices, brandNames, tRu);

  test('заголовки по столбцам, на языке интерфейса', () => {
    assert.equal(table.head.length, SPEC_COLUMNS.length);
    assert.deepEqual(table.head, ['Артикул', 'Производитель', 'Наименование', 'Тип', 'Ширина, мод.', 'Кол-во', 'Примечание']);
    assert.equal(specTable(build([]), enclosure, devices, brandNames, tEn).head[0], 'Article');
  });

  test('первой строкой корпус, потом устройства с количеством', () => {
    assert.deepEqual(table.rows[0], ['VA24B', 'Hager', 'Корпус Volta VA24B (накладной · 2 × 12 мод. · IP30 · без дверцы)', '', null, 1, '']);
    assert.deepEqual(table.rows.slice(1), [
      ['2CSF202004R1400', 'ABB', 'УЗО 40 А, 30 мА, тип A, 2P', 'F202 A-40/0.03', 2, 1, 'не проверено'],
      ['MCN116', 'Hager', 'Автомат C16, 1P', '', 1, 2, ''],
      ['SPN215', 'Hager', 'УЗИП тип 2, 1P+N', '', 1.5, 1, ''],
    ]);
  });

  test('пустой щит — только корпус', () => {
    assert.equal(specTable(build([]), enclosure, devices, brandNames, tRu).rows.length, 1);
  });
});

describe('toCsv', () => {
  const table = { head: ['A', 'B', 'C'], rows: [['x;y', 'кавычка "1"', 1.5], ['  край', null, 2], ['a,b', 'строка\nвторая', 0]] };

  test('ru: BOM, «;», десятичная запятая, CRLF, кавычки где нужно', () => {
    assert.equal(
      toCsv(table, 'ru'),
      '﻿A;B;C\r\n"x;y";"кавычка ""1""";1,5\r\n"  край";;2\r\na,b;"строка\nвторая";0\r\n',
    );
  });

  test('en: «,» и десятичная точка', () => {
    assert.equal(toCsv(table, 'en'), '﻿A,B,C\r\nx;y,"кавычка ""1""",1.5\r\n"  край",,2\r\n"a,b","строка\nвторая",0\r\n');
  });

  test('разделитель по языку', () => {
    assert.deepEqual(['ru', 'lt', 'en'].map(csvSeparator), [';', ';', ',']);
  });

  test('настоящая спецификация на литовском', async () => {
    const tLt = createTranslator(await messages('lt'), ru, 'lt');
    const csv = toCsv(specTable(build(['spd']), enclosure, devices, brandNames, tLt), 'lt');
    const lines = csv.slice(1).split('\r\n');
    assert.equal(lines[0], 'Prekės kodas;Gamintojas;Pavadinimas;Tipas;Plotis, mod.;Kiekis;Pastaba');
    assert.match(lines[2], /^SPN215;Hager;.*;;1,5;1;$/);
  });
});

describe('exportFileName', () => {
  test('как у файла проекта, со своим расширением', () => {
    const date = new Date('2026-11-23T10:00:00Z');
    assert.equal(exportFileName(enclosure, 'csv', date), 'dinboard-va24b-2026-11-23.csv');
    assert.equal(exportFileName(enclosure, 'xlsx', date), 'dinboard-va24b-2026-11-23.xlsx');
  });
});

describe('клеммники N/PE в спецификации', () => {
  const included = { ...enclosure, terminals: { included: true, blocks: [{ role: 'N' }], verified: false } };
  const notIncluded = {
    ...enclosure,
    terminals: {
      included: false,
      accessories: [
        { article: '1SPE007715F0743', role: 'PE', clamps: [[7, 16], [9, 6]], verified: true, source: 'https://x.example' },
        { article: 'N5', role: 'N', verified: false },
      ],
      verified: false,
    },
  };

  test('clampsText', () => {
    assert.equal(clampsText([[2, 25], [11, 16]], 'ru'), '2×25 + 11×16');
    assert.equal(clampsText([[5, 1.5]], 'ru'), '5×1,5');
  });

  test('в комплекте — пометка в строке корпуса; не подтверждено — с «(не проверено)»', () => {
    const verified = { ...included, terminals: { ...included.terminals, verified: true, source: 'https://x.example' } };
    assert.match(specTable(build([]), verified, devices, brandNames, tRu).rows[0][2], /, клеммники N\/PE в комплекте$/);
    // included.terminals.verified: false — в составе и выгрузках видно, что это не подтверждено
    assert.match(specTable(build([]), included, devices, brandNames, tRu).rows[0][2], /, клеммники N\/PE в комплекте \(не проверено\)$/);
  });

  test('не в комплекте: без флага — ничего, с флагом — аксессуары сразу после корпуса', () => {
    assert.equal(specTable(build([]), notIncluded, devices, brandNames, tRu).rows.length, 1);
    const board = { ...build(['mcb']), addTerminals: true };
    const rows = specTable(board, notIncluded, devices, brandNames, tRu).rows;
    assert.deepEqual(rows.slice(1, 3), [
      ['1SPE007715F0743', 'Hager', 'Клеммник PE, 7×16 + 9×6 мм²', '', null, 1, ''],
      ['N5', 'Hager', 'Клеммник N', '', null, 1, 'не проверено'],
    ]);
    assert.equal(rows[3][0], 'MCN116', 'потом устройства');
    assert.deepEqual(terminalsSpec(board, enclosure, tRu), { suffix: '', accessories: [] }, 'без данных о клеммниках');
  });
});

describe('гребёнки в спецификации', () => {
  const comb = { id: 'hager-kdn163a', brand: 'hager', article: 'KDN163A', phases: '1P', pinType: 'fork', lengthModules: 12, verified: true, source: 'https://x.example' };
  const other = { ...comb, id: 'hager-kb163', article: 'KB163', pinType: 'pin', lengthModules: 57, verified: false };
  const combsById = new Map([comb, other].map((c) => [c.id, c]));

  test('combsSpec: одинаковые суммируются, неизвестные пропускаются', () => {
    const board = { ...build(['mcb']), combs: ['hager-kdn163a', 'hager-kdn163a'] };
    assert.deepEqual(combsSpec(board, combsById).map(({ comb: c, count }) => [c.article, count]), [['KDN163A', 2]]);
    assert.deepEqual(combsSpec({ ...board, combs: ['nope', null] }, combsById), []);
  });

  test('название и строки в конце спецификации', () => {
    assert.equal(combName(comb, tRu), 'Гребёнка 1P, вилка, 12 мод.');
    assert.equal(combName(other, tEn), 'Comb busbar 1P, pin, 57 mod.');
    const board = { ...build(['mcb']), combs: ['hager-kb163', null] };
    const rows = specTable(board, enclosure, devices, brandNames, tRu, combsById).rows;
    assert.deepEqual(rows.at(-1), ['KB163', 'Hager', 'Гребёнка 1P, штырь, 57 мод.', '', null, 1, 'не проверено']);
  });
});

describe('аксессуары гребёнок и держатели в спецификации', () => {
  const cap = { id: 'hager-kzn023', brand: 'hager', series: 'KZN', article: 'KZN023', kind: 'end-cap', combSeries: ['KDN'], verified: true, source: 'https://x.example' };
  const covers = { id: 'hager-c20', brand: 'hager', series: 'X', article: 'C20', kind: 'tooth-cover', combSeries: ['KDN'], packQty: 20, verified: false };
  const partsById = new Map([cap, covers].map((p) => [p.id, p]));

  test('названия и строки с количеством; неизвестные пропускаются', () => {
    assert.equal(combPartName(cap, tRu), 'Торцевая заглушка гребёнки');
    assert.equal(combPartName(covers, tRu), 'Колпачки на свободные штыри гребёнки (упаковка 20 шт.)');
    const board = { ...build(['mcb']), combParts: { 'hager-kzn023': 2, 'hager-c20': 1, nope: 3 } };
    assert.deepEqual(combPartsSpec(board, partsById).map(({ part, count }) => [part.article, count]), [['KZN023', 2], ['C20', 1]]);
    const rows = specTable(board, enclosure, devices, brandNames, tRu, new Map(), partsById).rows;
    assert.deepEqual(rows.slice(-2), [
      ['KZN023', 'Hager', 'Торцевая заглушка гребёнки', '', null, 2, ''],
      ['C20', 'Hager', 'Колпачки на свободные штыри гребёнки (упаковка 20 шт.)', '', null, 1, 'не проверено'],
    ]);
  });

  test('держатель клеммников — строкой в составе вместе с клеммниками', () => {
    const enc = {
      ...enclosure,
      terminals: {
        included: false,
        accessories: [
          { article: 'PE1', role: 'PE', verified: false },
          { article: 'H1', role: 'holder', verified: true, source: 'https://x.example' },
        ],
        verified: false,
      },
    };
    const { accessories } = terminalsSpec({ ...build([]), addTerminals: true }, enc, tRu);
    assert.deepEqual(accessories.map((a) => [a.article, a.name]), [['PE1', 'Клеммник PE'], ['H1', 'Держатель клеммников']]);
  });
});
