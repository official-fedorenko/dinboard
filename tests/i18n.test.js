import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { createTranslator, loadMessages, LANGUAGES } from '../site/js/i18n.js';
import { deviceLabel, deviceTitle, enclosureDescription, enclosureSize, enclosureTitle, num } from '../site/js/format.js';
import { DEVICE_CATEGORIES, MOUNTINGS, DOORS } from '../site/js/catalog.js';
import { PROJECT_ERROR_CODES } from '../site/js/storage.js';
import { SITE_ROOT } from '../tools/serve.js';

const ru = JSON.parse(await readFile(join(SITE_ROOT, 'i18n', 'ru.json'), 'utf8'));
const t = createTranslator(ru);

describe('createTranslator', () => {
  test('подстановка параметров', () => {
    const tr = createTranslator({ hi: 'Привет, {name}! {name}?', n: '{a}+{b}' });
    assert.equal(tr('hi', { name: 'Мир' }), 'Привет, Мир! Мир?');
    assert.equal(tr('n', { a: 1 }), '1+{b}', 'неизвестный параметр остаётся как есть');
  });

  test('нет ключа: запасной словарь, затем сам ключ', () => {
    const tr = createTranslator({ a: 'A' }, { b: 'B' });
    assert.equal(tr('a'), 'A');
    assert.equal(tr('b'), 'B');
    assert.equal(tr('c'), 'c');
  });

  test('имена из прототипа не считаются переводами', () => {
    assert.equal(createTranslator({})('constructor'), 'constructor');
    assert.equal(createTranslator({ x: '{toString}' })('x', {}), '{toString}');
  });
});

describe('loadMessages', () => {
  test('только известные языки и только объект', async () => {
    await assert.rejects(loadMessages('../secret', new URL('https://x.example/i18n/'), async () => ({})));
    await assert.rejects(loadMessages('ru', new URL('https://x.example/i18n/'), async () => ['nope']));
    let asked;
    const msgs = await loadMessages('ru', new URL('https://x.example/i18n/'), async (url) => ((asked = String(url)), { a: 'b' }));
    assert.deepEqual(msgs, { a: 'b' });
    assert.equal(asked, 'https://x.example/i18n/ru.json');
    assert.deepEqual(LANGUAGES, ['ru', 'lt', 'en']);
  });
});

describe('ключи переводов', () => {
  // Ключи, которые код собирает динамически из данных каталога
  const dynamicKeys = [
    ...Object.keys(DEVICE_CATEGORIES).flatMap((c) => [`device.${c}.title`, `category.${c}`]),
    ...MOUNTINGS.map((m) => `mounting.${m}`),
    ...DOORS.map((d) => `door.${d}`),
    ...PROJECT_ERROR_CODES.map((c) => `project.error.${c}`),
  ];

  async function staticKeys() {
    const dir = join(SITE_ROOT, 'js');
    const keys = new Set();
    for (const file of await readdir(dir)) {
      const source = await readFile(join(dir, file), 'utf8');
      // t('ключ' ...), tool('ключ' ...) и button('ключ' ...) — помощники в ui.js,
      // а также { key: 'ключ' } — сообщения из restoreProject (storage.js)
      for (const m of source.matchAll(/\b(?:t|tool|button)\(\s*'([a-zA-Z0-9_.]+)'/g)) keys.add(m[1]);
      for (const m of source.matchAll(/\bkey:\s*'([a-zA-Z0-9_.]+)'/g)) keys.add(m[1]);
    }
    return keys;
  }

  test('все ключи из кода есть в ru.json', async () => {
    const missing = [...(await staticKeys()), ...dynamicKeys].filter((k) => !Object.hasOwn(ru, k));
    assert.deepEqual(missing, []);
  });

  test('в ru.json нет неиспользуемых ключей', async () => {
    const used = new Set([...(await staticKeys()), ...dynamicKeys]);
    const unused = Object.keys(ru).filter((k) => !used.has(k));
    assert.deepEqual(unused, []);
  });

  test('все значения — непустые строки', () => {
    const bad = Object.entries(ru).filter(([, v]) => typeof v !== 'string' || v.trim() === '');
    assert.deepEqual(bad, []);
  });
});

describe('format', () => {
  const mcb = { category: 'mcb', article: 'MCN116', specs: { poles: '1P', ratedCurrentA: 16, curve: 'C', breakingCapacityKa: 6 } };
  const rcd = { category: 'rcd', article: 'CDA240J', specs: { poles: '1P+N', ratedCurrentA: 40, sensitivityMa: 30, rcdType: 'A' } };
  const rcbo = {
    category: 'rcbo',
    article: 'ADA966D',
    specs: { poles: '1P+N', ratedCurrentA: 16, curve: 'C', breakingCapacityKa: 6, sensitivityMa: 30, rcdType: 'A' },
  };
  const sw = { category: 'switch', article: 'SBN263', specs: { poles: '2P', ratedCurrentA: 63 } };
  const spd = { category: 'spd', article: 'SPE240', specs: { poles: '1P+N', spdType: '2' } };

  test('названия устройств', () => {
    assert.equal(deviceTitle(mcb, t), 'Автомат C16, 1P');
    assert.equal(deviceTitle(rcd, t), 'УЗО 40 А, 30 мА, тип A, 1P+N');
    assert.equal(deviceTitle(rcbo, t), 'Дифавтомат C16, 30 мА, тип A, 1P+N');
    assert.equal(deviceTitle(sw, t), 'Выключатель нагрузки 63 А, 2P');
    assert.equal(deviceTitle(spd, t), 'УЗИП тип 2, 1P+N');
  });

  test('подписи на устройствах', () => {
    assert.deepEqual(deviceLabel(mcb, t), { main: 'C16', sub: '1P' });
    assert.deepEqual(deviceLabel(rcd, t), { main: '40 А', sub: '30 мА A' });
    assert.deepEqual(deviceLabel(rcbo, t), { main: 'C16', sub: '30 мА A' });
    assert.deepEqual(deviceLabel(sw, t), { main: '63 А', sub: '2P' });
    assert.deepEqual(deviceLabel(spd, t), { main: 'Т2', sub: '1P+N' });
  });

  test('корпус', () => {
    const enc = {
      series: 'Volta',
      article: 'VA24B',
      mounting: 'surface',
      rows: 2,
      modulesPerRow: 12,
      ipRating: 30,
      door: 'none',
      dimensionsMm: { width: 305, height: 370, depth: 96.5 },
    };
    assert.equal(enclosureTitle(enc), 'Volta VA24B');
    assert.equal(enclosureDescription(enc, t), 'накладной · 2 × 12 мод. · IP30 · без дверцы');
    assert.equal(enclosureSize(enc, t), '305 × 370 × 96.5 мм');
  });

  test('num убирает лишние нули', () => {
    assert.equal(num(1), '1');
    assert.equal(num(1.5), '1.5');
    assert.equal(num(96.50), '96.5');
  });
});
