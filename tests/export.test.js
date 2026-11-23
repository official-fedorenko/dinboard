import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { specTable, toCsv, csvSeparator, exportFileName, SPEC_COLUMNS } from '../site/js/export.js';
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
