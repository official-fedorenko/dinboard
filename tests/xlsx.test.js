import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 as zlibCrc32 } from 'node:zlib';

import { crc32, zip, xmlText, columnName, sheetName, xlsxWorkbook } from '../site/js/xlsx.js';

/** Разбор zip без сжатия: по центральному каталогу, с проверкой локальных заголовков. */
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50, 'конец каталога');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  assert.equal(at + view.getUint32(end + 12, true), end, 'каталог стоит прямо перед концом');
  const files = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50, 'запись каталога');
    assert.equal(view.getUint16(at + 10, true), 0, 'без сжатия');
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    assert.equal(view.getUint32(at + 24, true), size);
    const nameLen = view.getUint16(at + 28, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    const local = view.getUint32(at + 42, true);
    assert.equal(view.getUint32(local, true), 0x04034b50, 'локальный заголовок');
    assert.equal(view.getUint32(local + 14, true), crc);
    assert.equal(view.getUint16(local + 26, true), nameLen);
    const start = local + 30 + nameLen + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    assert.equal(zlibCrc32(data), crc, `CRC ${name}`);
    files.set(name, decoder.decode(data));
    at += 46 + nameLen + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return files;
}

/** Грубая проверка, что XML собран правильно: теги закрыты по порядку, нет голых & и <. */
function assertWellFormed(xml, name) {
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, '');
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(body), `${name}: неэкранированный &`);
  const stack = [];
  for (const [, close, tag, self] of body.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)(?:\s[^<>]*?)?(\/?)>/g)) {
    if (self) continue;
    if (close) assert.equal(stack.pop(), tag, `${name}: закрыт не тот тег`);
    else stack.push(tag);
  }
  assert.deepEqual(stack, [], `${name}: незакрытые теги`);
  assert.ok(!/<(?![A-Za-z_/])/.test(body), `${name}: голый <`);
}

describe('crc32', () => {
  test('совпадает с zlib', () => {
    for (const text of ['', 'a', 'Dinboard', 'Щит ąčęėįšųūž'.repeat(50)]) {
      const bytes = new TextEncoder().encode(text);
      assert.equal(crc32(bytes), zlibCrc32(bytes), text.slice(0, 10));
    }
  });
});

describe('zip', () => {
  test('файлы читаются обратно, CRC и размеры верны', () => {
    const files = unzip(zip([{ name: 'a.txt', data: 'привет' }, { name: 'b/c.bin', data: new Uint8Array([0, 1, 255]) }]));
    assert.deepEqual([...files.keys()], ['a.txt', 'b/c.bin']);
    assert.equal(files.get('a.txt'), 'привет');
  });

  test('дата — в формате MS-DOS (местное время)', () => {
    const bytes = zip([{ name: 'a', data: 'x' }], new Date(2026, 10, 23, 14, 30, 59));
    const view = new DataView(bytes.buffer);
    assert.equal(view.getUint16(10, true), (14 << 11) | (30 << 5) | 29);
    assert.equal(view.getUint16(12, true), ((2026 - 1980) << 9) | (11 << 5) | 23);
  });

  test('имена не ASCII — ошибка', () => {
    assert.throws(() => zip([{ name: 'щит.xml', data: '' }]));
  });
});

describe('помощники', () => {
  test('xmlText экранирует и убирает запрещённые символы', () => {
    assert.equal(xmlText('a<b>&"c"'), 'a&lt;b&gt;&amp;&quot;c&quot;');
    assert.equal(xmlText('x\u0000y\u0007z\ud800'), 'xyz');
    assert.equal(xmlText('таб\tи\nстрока 😀'), 'таб\tи\nстрока 😀');
  });

  test('columnName', () => {
    assert.deepEqual([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName), ['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });

  test('sheetName по правилам Excel', () => {
    assert.equal(sheetName('Состав щита'), 'Состав щита');
    assert.equal(sheetName('a/b:c'), 'a b c');
    assert.equal(sheetName('x'.repeat(40)).length, 31);
    assert.equal(sheetName("'"), 'Sheet1');
    assert.equal(sheetName(''), 'Sheet1');
  });
});

describe('xlsxWorkbook', () => {
  const book = {
    sheet: 'Состав щита',
    head: ['Артикул', 'Наименование', 'Ширина, мод.', 'Кол-во'],
    rows: [
      ['VA24B', 'Корпус <Volta> & "двойной"', null, 1],
      ['MCN116', 'Автомат C16, 1P', 1, 4],
      ['CDA240J', 'УЗО 40 A', 1.5, 1],
    ],
  };
  const files = unzip(xlsxWorkbook(book, new Date(2026, 10, 23)));

  test('все обязательные части на месте, XML собран правильно', () => {
    assert.deepEqual([...files.keys()].sort(), [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    for (const [name, xml] of files) {
      assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'), name);
      assertWellFormed(xml, name);
    }
  });

  test('связи указывают на существующие части', () => {
    const types = files.get('[Content_Types].xml');
    for (const part of ['/xl/workbook.xml', '/xl/worksheets/sheet1.xml', '/xl/styles.xml']) {
      assert.ok(types.includes(`PartName="${part}"`), part);
      assert.ok(files.has(part.slice(1)), part);
    }
    assert.match(files.get('_rels/.rels'), /Target="xl\/workbook\.xml"/);
    assert.match(files.get('xl/_rels/workbook.xml.rels'), /Target="worksheets\/sheet1\.xml"/);
    assert.match(files.get('xl/workbook.xml'), /<sheet name="Состав щита" sheetId="1" r:id="rId1"\/>/);
  });

  test('заголовок жирный, числа — числами, текст экранирован, пустые ячейки пропущены', () => {
    const sheet = files.get('xl/worksheets/sheet1.xml');
    assert.match(sheet, /<row r="1"><c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Артикул<\/t><\/is><\/c>/);
    assert.match(sheet, /<c r="D3"><v>4<\/v><\/c>/);
    assert.match(sheet, /<c r="C4"><v>1\.5<\/v><\/c>/);
    assert.match(sheet, /Корпус &lt;Volta&gt; &amp; &quot;двойной&quot;/);
    assert.ok(!sheet.includes('r="C2"'), 'null — без ячейки');
    assert.match(sheet, /state="frozen"/);
    assert.equal((sheet.match(/<col /g) ?? []).length, 4);
  });
});
