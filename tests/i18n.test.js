import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { SPEC_COLUMNS } from '../site/js/export.js';
import { createTranslator, loadMessages, LANGUAGES, placeholders, pickLanguage, formatNumber } from '../site/js/i18n.js';
import { deviceLabel, deviceTitle, deviceRef, enclosureDescription, enclosureSize, enclosureTitle, num } from '../site/js/format.js';
import { DEVICE_CATEGORIES, MOUNTINGS, DOORS, COMB_PIN_TYPES, COMB_PART_KINDS } from '../site/js/catalog.js';
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
    ...LANGUAGES.map((lang) => `language.${lang}`),
    ...['warning', 'info'].map((level) => `check.level.${level}`),
    ...SPEC_COLUMNS.map((c) => `summary.${c}`),
    ...COMB_PIN_TYPES.map((p) => `comb.pin.${p}`),
    ...COMB_PART_KINDS.map((k) => `combPart.${k}`),
  ];

  async function staticKeys() {
    const dir = join(SITE_ROOT, 'js');
    const keys = new Set();
    for (const file of await readdir(dir)) {
      const source = await readFile(join(dir, file), 'utf8');
      // t('ключ' ...), tool('ключ' ...) и button('ключ' ...) — помощники в ui.js,
      // а также { key: 'ключ' } — сообщения из restoreProject (storage.js)
      // warn('ключ' ...) и info('ключ' ...) — подсказки из checks.js
      for (const m of source.matchAll(/\b(?:t|tool|button|warn|info)\(\s*'([a-zA-Z0-9_.]+)'/g)) keys.add(m[1]);
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

const files = Object.fromEntries(
  await Promise.all(
    LANGUAGES.map(async (lang) => [lang, JSON.parse(await readFile(join(SITE_ROOT, 'i18n', `${lang}.json`), 'utf8'))]),
  ),
);

describe('все языки', () => {
  test('у каждого языка тот же набор ключей, что у русского', () => {
    for (const lang of LANGUAGES) {
      assert.deepEqual(Object.keys(files[lang]).sort(), Object.keys(ru).sort(), lang);
    }
  });

  test('подстановки {…} в каждом переводе те же, что в русском', () => {
    for (const lang of LANGUAGES) {
      const wrong = Object.keys(ru).filter((key) => placeholders(files[lang][key]).join() !== placeholders(ru[key]).join());
      assert.deepEqual(wrong, [], lang);
    }
  });

  test('все значения — непустые строки; переводы не совпадают с русским (кроме общих)', () => {
    const same = new Set(['enclosure.layout', 'device.modules', 'language.ru', 'language.lt', 'language.en', 'summary.enclosure']);
    for (const lang of ['lt', 'en']) {
      const bad = Object.entries(files[lang]).filter(([, v]) => typeof v !== 'string' || v.trim() === '');
      assert.deepEqual(bad, [], lang);
      const untranslated = Object.keys(ru).filter((k) => !same.has(k) && files[lang][k] === ru[k]);
      assert.deepEqual(untranslated, [], `${lang}: похоже, не переведено`);
    }
  });

  test('в литовском и английском нет кириллицы (кроме названия языка «Русский»)', () => {
    for (const lang of ['lt', 'en']) {
      const cyr = Object.entries(files[lang]).filter(([k, v]) => k !== 'language.ru' && /[А-Яа-яЁё]/.test(v));
      assert.deepEqual(cyr, [], lang);
    }
  });

  test('подписи на каждом языке', () => {
    const mcb = { category: 'mcb', specs: { poles: '1P', ratedCurrentA: 16, curve: 'C', breakingCapacityKa: 6 } };
    const tr = (lang) => createTranslator(files[lang], ru, lang);
    assert.equal(deviceTitle(mcb, tr('lt')), 'Automatinis jungiklis C16, 1P');
    assert.equal(deviceTitle(mcb, tr('en')), 'Circuit breaker C16, 1P');
    const enc = { mounting: 'flush', rows: 1, modulesPerRow: 12, ipRating: 30, door: 'opaque', dimensionsMm: { width: 348, height: 356.5, depth: 94.5 } };
    assert.equal(enclosureSize(enc, tr('ru')), '348 × 356,5 × 94,5 мм');
    assert.equal(enclosureSize(enc, tr('lt')), '348 × 356,5 × 94,5 mm');
    assert.equal(enclosureSize(enc, tr('en')), '348 × 356.5 × 94.5 mm');
    assert.equal(enclosureDescription(enc, tr('lt')), 'potinkinis · 1 × 12 mod. · IP30 · nepermatomos durelės');
  });
});

describe('язык и числа', () => {
  test('pickLanguage: сохранённый выбор, затем язык браузера, затем русский', () => {
    assert.equal(pickLanguage('en', ['lt-LT']), 'en');
    assert.equal(pickLanguage(null, ['de-DE', 'lt-LT', 'en']), 'lt');
    assert.equal(pickLanguage('xx', ['EN-gb']), 'en');
    assert.equal(pickLanguage(undefined, ['de', 'fr']), 'ru');
    assert.equal(pickLanguage('__proto__', []), 'ru');
  });

  test('formatNumber по правилам языка, без разделителя тысяч', () => {
    assert.equal(formatNumber(96.5, 'ru'), '96,5');
    assert.equal(formatNumber(96.5, 'lt'), '96,5');
    assert.equal(formatNumber(96.5, 'en'), '96.5');
    assert.equal(formatNumber(1200, 'ru'), '1200');
    assert.equal(formatNumber(12, 'lt'), '12');
    assert.equal(formatNumber(96.5), '96.5', 'без языка — как есть');
  });

  test('запасной словарь: недостающий ключ берётся из русского', () => {
    const tr = createTranslator({ a: 'A' }, { b: 'Б' }, 'en');
    assert.equal(tr('b'), 'Б');
    assert.equal(tr.lang, 'en');
  });
});

describe('format', () => {
  const mcb = { category: 'mcb', article: 'MCN116', specs: { poles: '1P', ratedCurrentA: 16, curve: 'C', breakingCapacityKa: 6 } };
  const rcd = { category: 'rcd', article: 'CDA240J', specs: { poles: '2P', ratedCurrentA: 40, sensitivityMa: 30, rcdType: 'A' } };
  const rcbo = {
    category: 'rcbo',
    article: 'ADA966D',
    specs: { poles: '1P+N', ratedCurrentA: 16, curve: 'C', breakingCapacityKa: 6, sensitivityMa: 30, rcdType: 'A' },
  };
  const sw = { category: 'switch', article: 'SBN263', specs: { poles: '2P', ratedCurrentA: 63 } };
  const spd = { category: 'spd', article: 'SPE240', specs: { poles: '1P+N', spdType: '2' } };

  test('названия устройств', () => {
    assert.equal(deviceTitle(mcb, t), 'Автомат C16, 1P');
    assert.equal(deviceTitle(rcd, t), 'УЗО 40 А, 30 мА, тип A, 2P');
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

  test('тип производителя в названиях', () => {
    assert.equal(enclosureTitle({ series: 'Mistral41', article: '1SPE007717F9993', model: '41A12X21' }), 'Mistral41 41A12X21');
    assert.equal(deviceRef({ model: 'S201-C16' }, 'ABB'), 'ABB S201-C16');
    assert.equal(deviceRef({}, 'Hager'), 'Hager');
  });

  test('num убирает лишние нули', () => {
    assert.equal(num(1), '1');
    assert.equal(num(1.5), '1.5');
    assert.equal(num(96.50), '96.5');
  });
});
