import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { specTable, toCsv, csvSeparator, exportFileName, carriersSpec, carrierName, insertName, clampsText, combsSpec, combName, combPartsSpec, combPartName, SPEC_COLUMNS } from '../site/js/export.js';
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

describe('держатели и клеммы N/PE в спецификации', () => {
  const carriersById = indexById([
    { id: 'plate', brand: 'hager', kind: 'plate', series: 'volta', article: 'VZ522', lengthMm: 270, positions: ['top'], verified: false },
    { id: 'qc', brand: 'hager', kind: 'carrier', series: 'QuickConnect', article: 'VZ711', lengthMm: 240, positions: ['top'], verified: true, source: 'https://x.example' },
    { id: 'zone', brand: 'legrand', kind: 'zone', lengthMm: 226, positions: ['top'], verified: true, source: 'https://x.example' },
  ]);
  const insertsById = indexById([
    { id: 'plate-n', brand: 'hager', role: 'N', clamps: [[1, 25], [16, 16]], widthMm: 130, fixed: true, verified: false },
    { id: 'kn06n', brand: 'hager', role: 'N', article: 'KN06N', clamps: [[1, 16], [5, 4]], widthMm: 30, verified: true, source: 'https://x.example' },
    { id: 'kl', brand: 'eaton', role: 'universal', article: '236845', clamps: [[2, 25], [23, 16]], widthMm: 190, verified: true, source: 'https://x.example' },
    { id: 'bar', brand: 'legrand', role: 'N+PE', article: '134812', clamps: [[24, 16], [24, 10]], widthMm: 226, verified: true, source: 'https://x.example' },
  ]);
  const catalog = { carriersById, insertsById };
  const brands = new Map([...brandNames, ['eaton', 'Eaton'], ['legrand', 'Legrand']]);

  test('clampsText и названия', () => {
    assert.equal(clampsText([[2, 25], [11, 16]], 'ru'), '2×25 + 11×16');
    assert.equal(clampsText([[5, 1.5]], 'ru'), '5×1,5');
    assert.equal(carrierName(carriersById.get('qc'), tRu), 'Держатель клемм N/PE QuickConnect, 240 мм');
    assert.equal(carrierName(carriersById.get('zone'), tEn), 'Place for an N/PE bar, 226 mm');
    assert.equal(insertName(insertsById.get('kn06n'), 'N', tRu), 'Клемма N, 1×16 + 5×4 мм²');
    assert.equal(insertName(insertsById.get('kl'), 'PE', tRu), 'Шина PE (по крышке), 2×25 + 23×16 мм²');
  });

  test('каждый держатель и клемма — своей строкой после корпуса; с завода — «в комплекте корпуса»', () => {
    const board = {
      ...build(['mcb']),
      carriers: [
        { carrierId: 'plate', position: 'top', included: true, inserts: [{ insertId: 'plate-n', pos: 0, included: true }] },
        { carrierId: 'qc', position: 'bottom', included: false, inserts: [{ insertId: 'kn06n', pos: 0 }, { insertId: 'kn06n', pos: 30 }, { insertId: 'kl', pos: 0, role: 'PE' }] },
        { carrierId: 'zone', position: 'top', included: true, inserts: [{ insertId: 'bar', pos: 0 }] },
        { carrierId: 'gone', position: 'top', included: false, inserts: [] },
      ],
    };
    const rows = specTable(board, enclosure, devices, brands, tRu, new Map(), new Map(), catalog).rows;
    assert.deepEqual(rows.slice(1, 7), [
      ['VZ522', 'Hager', 'Колодка N/PE volta, 270 мм', '', null, 1, 'в комплекте корпуса, не проверено'],
      ['', 'Hager', 'Клемма N, 1×25 + 16×16 мм²', '', null, 1, 'в комплекте корпуса, не проверено'],
      ['VZ711', 'Hager', 'Держатель клемм N/PE QuickConnect, 240 мм', '', null, 1, ''],
      ['KN06N', 'Hager', 'Клемма N, 1×16 + 5×4 мм²', '', null, 2, ''],
      ['236845', 'Eaton', 'Шина PE (по крышке), 2×25 + 23×16 мм²', '', null, 1, ''],
      ['134812', 'Legrand', 'Клемма N+PE, 24×16 + 24×10 мм²', '', null, 1, ''],
    ]);
    assert.equal(rows[7][0], 'MCN116', 'потом устройства');
    assert.equal(carriersSpec(board, carriersById, insertsById, tRu).some((l) => l.name.startsWith('Место')), false, 'место под шину — не деталь');
    assert.equal(specTable(board, enclosure, devices, brands, tRu).rows.length, 2, 'без каталога держателей — без строк держателей');
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

describe('аксессуары гребёнок в спецификации', () => {
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
});
