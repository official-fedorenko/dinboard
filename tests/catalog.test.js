import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

import {
  validateIndex,
  validateBrandFile,
  validateCatalog,
  loadCatalog,
  CatalogError,
  DEVICE_CATEGORIES,
  categorySchema,
} from '../site/js/catalog.js';
import { SITE_ROOT } from '../tools/serve.js';

const enclosure = (over = {}) => ({
  id: 'acme-box-12',
  brand: 'acme',
  series: 'Box',
  article: 'BOX12',
  mounting: 'surface',
  rows: 1,
  modulesPerRow: 12,
  material: 'plastic',
  door: 'transparent',
  ipRating: 41,
  dimensionsMm: { width: 250, height: 200, depth: 100 },
  verified: true,
  source: 'https://example.com/box12',
  ...over,
});

const mcb = (over = {}) => ({
  id: 'acme-c16',
  brand: 'acme',
  series: 'M',
  article: 'C16',
  category: 'mcb',
  modules: 1,
  specs: { poles: '1P', ratedCurrentA: 16, curve: 'C', breakingCapacityKa: 6 },
  verified: false,
  ...over,
});

const brandFile = (over = {}) => ({
  schemaVersion: 1,
  brand: { id: 'acme', name: 'Acme' },
  enclosures: [enclosure()],
  devices: [mcb()],
  ...over,
});

const hasError = (errors, fragment) =>
  assert.ok(
    errors.some((e) => e.includes(fragment)),
    `нет ошибки с "${fragment}" в:\n${errors.join('\n')}`,
  );

describe('validateBrandFile', () => {
  test('корректный файл проходит без ошибок', () => {
    assert.deepEqual(validateBrandFile(brandFile(), 'acme.json'), []);
  });

  test('все категории устройств из примеров проходят', () => {
    const devices = [
      mcb(),
      mcb({ id: 'acme-rcd', category: 'rcd', modules: 2, specs: { poles: '2P', ratedCurrentA: 40, sensitivityMa: 30, rcdType: 'A' } }),
      mcb({
        id: 'acme-rcbo',
        category: 'rcbo',
        specs: { poles: '1P+N', ratedCurrentA: 16, curve: 'C', breakingCapacityKa: 6, sensitivityMa: 30, rcdType: 'A' },
      }),
      mcb({ id: 'acme-sw', category: 'switch', modules: 2, specs: { poles: '2P', ratedCurrentA: 63 } }),
      mcb({ id: 'acme-spd', category: 'spd', modules: 2, specs: { poles: '1P+N', spdType: '2' } }),
    ];
    assert.deepEqual(validateBrandFile(brandFile({ devices })), []);
    assert.deepEqual(
      Object.keys(DEVICE_CATEGORIES).sort(),
      [...new Set(devices.map((d) => d.category))].sort(),
      'пример есть для каждой категории',
    );
  });

  test('обязательные поля', () => {
    const { article, ...noArticle } = mcb();
    hasError(validateBrandFile(brandFile({ devices: [noArticle] })), 'devices[0].article: обязательное поле');
    const { dimensionsMm, ...noDims } = enclosure();
    hasError(validateBrandFile(brandFile({ enclosures: [noDims] })), 'enclosures[0].dimensionsMm: обязательное поле');
  });

  test('неизвестные поля запрещены (опечатки)', () => {
    hasError(validateBrandFile(brandFile({ devices: [mcb({ modlues: 1 })] })), 'devices[0].modlues: неизвестное поле');
    hasError(validateBrandFile(brandFile({ extra: 1 })), 'brand.extra: неизвестное поле');
  });

  test('категория и характеристики', () => {
    hasError(validateBrandFile(brandFile({ devices: [mcb({ category: 'fuse' })] })), 'category: ожидалось одно из');
    hasError(
      validateBrandFile(brandFile({ devices: [mcb({ specs: { poles: '1P', ratedCurrentA: 16, curve: 'C' } })] })),
      'specs.breakingCapacityKa: обязательное поле',
    );
    hasError(
      validateBrandFile(brandFile({ devices: [mcb({ specs: { ...mcb().specs, curve: 'K' } })] })),
      'specs.curve: ожидалось одно из',
    );
    hasError(
      validateBrandFile(brandFile({ devices: [mcb({ specs: { ...mcb().specs, sensitivityMa: 30 } })] })),
      'specs.sensitivityMa: неизвестное поле',
    );
    hasError(
      validateBrandFile(brandFile({ devices: [mcb({ specs: { ...mcb().specs, ratedCurrentA: '16' } })] })),
      'specs.ratedCurrentA: нужно положительное число',
    );
  });

  test('ширина в модулях: шаг 0.5', () => {
    assert.deepEqual(validateBrandFile(brandFile({ devices: [mcb({ modules: 1.5 })] })), []);
    for (const bad of [0, 0.25, 13, '1']) {
      hasError(validateBrandFile(brandFile({ devices: [mcb({ modules: bad })] })), 'modules: ширина в модулях');
    }
  });

  test('корпус: ряды, модули, размеры, IP', () => {
    hasError(validateBrandFile(brandFile({ enclosures: [enclosure({ rows: 0 })] })), 'rows: нужно целое число');
    hasError(validateBrandFile(brandFile({ enclosures: [enclosure({ modulesPerRow: 12.5 })] })), 'modulesPerRow');
    hasError(
      validateBrandFile(brandFile({ enclosures: [enclosure({ dimensionsMm: { width: 250, height: 200 } })] })),
      'depth: нужно положительное число',
    );
    hasError(
      validateBrandFile(brandFile({ enclosures: [enclosure({ dimensionsMm: { width: 250, height: 0, depth: 96.5 } })] })),
      'height: нужно положительное число',
    );
    assert.deepEqual(
      validateBrandFile(brandFile({ enclosures: [enclosure({ dimensionsMm: { width: 305, height: 245, depth: 96.5 } })] })),
      [],
      'дробная глубина (96.5 мм у Hager Volta) допустима',
    );
    hasError(validateBrandFile(brandFile({ enclosures: [enclosure({ ipRating: 'IP41' })] })), 'ipRating');
    hasError(validateBrandFile(brandFile({ enclosures: [enclosure({ door: 'glass' })] })), 'door: ожидалось одно из');
  });

  test('id, бренд и ссылка на источник', () => {
    hasError(validateBrandFile(brandFile({ devices: [mcb({ id: 'Acme C16' })] })), 'devices[0].id: id:');
    hasError(validateBrandFile(brandFile({ devices: [mcb({ brand: 'other' })] })), 'brand: должен совпадать с "acme"');
    hasError(validateBrandFile(brandFile({ devices: [mcb({ source: 'http://example.com' })] })), 'source: нужна ссылка https://');
    hasError(validateBrandFile(brandFile({ devices: [mcb({ source: 'javascript:alert(1)' })] })), 'source: нужна ссылка https://');
  });

  test('встроенные имена объектов (constructor, toString, __proto__) не считаются известными', () => {
    for (const category of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      hasError(validateBrandFile(brandFile({ devices: [mcb({ category, specs: {} })] })), 'category: ожидалось одно из');
    }
    hasError(validateBrandFile(brandFile({ devices: [mcb({ constructor: 'x' })] })), 'devices[0].constructor: неизвестное поле');
    hasError(
      validateBrandFile(brandFile({ devices: [mcb({ specs: { ...mcb().specs, toString: 1 } })] })),
      'specs.toString: неизвестное поле',
    );
    // Ключ "__proto__" из JSON становится собственным полем объекта
    const fromJson = JSON.parse(JSON.stringify(brandFile()).replace('"series":"M"', '"series":"M","__proto__":{"x":1}'));
    hasError(validateBrandFile(fromJson), 'devices[0].__proto__: неизвестное поле');
    hasError(
      validateIndex(JSON.parse('{"schemaVersion":1,"brands":[{"id":"acme","name":"Acme","file":"acme.json","__proto__":1}]}')),
      'brands[0].__proto__: неизвестное поле',
    );
  });

  test('categorySchema: только свои категории', () => {
    assert.equal(categorySchema('mcb'), DEVICE_CATEGORIES.mcb);
    for (const bad of ['constructor', '__proto__', 'toString', 'fuse', undefined, 1]) {
      assert.equal(categorySchema(bad), null, String(bad));
    }
  });

  test('verified: true требует source', () => {
    const { source, ...noSource } = enclosure();
    hasError(validateBrandFile(brandFile({ enclosures: [noSource] })), 'enclosures[0].source: обязательно при verified: true');
    hasError(validateBrandFile(brandFile({ devices: [mcb({ verified: true })] })), 'devices[0].source: обязательно при verified: true');
    assert.deepEqual(validateBrandFile(brandFile({ devices: [mcb({ verified: false })] })), [], 'без source можно при verified: false');
  });

  test('УЗИП: необязательный список систем заземления networks', () => {
    const spd = (networks) => mcb({ id: 'acme-spd', category: 'spd', modules: 2, specs: { poles: '1P+N', spdType: '2', ...(networks === undefined ? {} : { networks }) } });
    assert.deepEqual(validateBrandFile(brandFile({ devices: [spd()] })), [], 'без networks можно');
    assert.deepEqual(validateBrandFile(brandFile({ devices: [spd(['TN-S', 'TT'])] })), []);
    for (const bad of [[], ['TN-S', 'TN-S'], ['IT'], 'TT', [1]]) {
      hasError(validateBrandFile(brandFile({ devices: [spd(bad)] })), 'specs.networks: нужен непустой список');
    }
    hasError(validateBrandFile(brandFile({ devices: [mcb({ specs: { ...mcb().specs, networks: ['TT'] } })] })), 'specs.networks: неизвестное поле');
  });

  test('необязательное поле model (тип у производителя)', () => {
    assert.deepEqual(validateBrandFile(brandFile({ devices: [mcb({ model: 'S201-C16' })], enclosures: [enclosure({ model: '41A12X21' })] })), []);
    hasError(validateBrandFile(brandFile({ devices: [mcb({ model: '' })] })), 'devices[0].model: нужна непустая строка');
    hasError(validateBrandFile(brandFile({ enclosures: [enclosure({ model: 5 })] })), 'enclosures[0].model: нужна непустая строка');
  });

  test('версия схемы и не-объекты', () => {
    hasError(validateBrandFile(brandFile({ schemaVersion: 2 })), 'schemaVersion: ожидалось 1');
    assert.deepEqual(validateBrandFile(null, 'x.json'), ['x.json: нужен объект']);
    hasError(validateBrandFile(brandFile({ devices: [null] })), 'devices[0]: нужен объект');
  });
});

describe('validateIndex', () => {
  const index = (brands) => ({ schemaVersion: 1, brands });

  test('корректный индекс', () => {
    assert.deepEqual(validateIndex(index([{ id: 'acme', name: 'Acme', file: 'acme.json' }])), []);
  });

  test('имя файла не может выйти из папки data', () => {
    for (const file of ['../acme.json', 'sub/acme.json', 'acme.js', 'https://evil.example/a.json']) {
      hasError(validateIndex(index([{ id: 'acme', name: 'Acme', file }])), 'file: имя файла');
    }
  });

  test('повтор бренда и пустой список', () => {
    const a = { id: 'acme', name: 'Acme', file: 'acme.json' };
    hasError(validateIndex(index([a, { ...a, file: 'acme2.json' }])), 'повтор "acme"');
    hasError(validateIndex(index([])), 'index.brands: нужен непустой список');
  });
});

describe('loadCatalog', () => {
  const fakeFetch = (files) => async (url) => {
    const name = String(url).split('/').pop();
    if (!(name in files)) throw new Error(`нет файла ${name}`);
    return structuredClone(files[name]);
  };
  const base = new URL('https://site.example/dinboard/data/');

  test('собирает бренды, корпуса и устройства', async () => {
    const catalog = await loadCatalog(
      base,
      fakeFetch({
        'index.json': { schemaVersion: 1, brands: [{ id: 'acme', name: 'Acme', file: 'acme.json' }] },
        'acme.json': brandFile(),
      }),
    );
    assert.deepEqual(catalog.brands, [{ id: 'acme', name: 'Acme' }]);
    assert.equal(catalog.enclosures.length, 1);
    assert.equal(catalog.devices.length, 1);
  });

  test('id бренда в файле должен совпадать с index.json', async () => {
    await assert.rejects(
      loadCatalog(
        base,
        fakeFetch({
          'index.json': { schemaVersion: 1, brands: [{ id: 'other', name: 'Other', file: 'acme.json' }] },
          'acme.json': brandFile(),
        }),
      ),
      (err) => err instanceof CatalogError && err.errors.some((e) => e.includes('не совпадает с index.json')),
    );
  });

  test('повтор id в разных брендах — ошибка', () => {
    const errors = validateCatalog({ enclosures: [enclosure()], devices: [mcb({ id: 'acme-box-12' })] });
    hasError(errors, 'id "acme-box-12" повторяется');
  });

  test('ошибочный индекс не ведёт к загрузке файлов брендов', async () => {
    let calls = 0;
    const fetchJson = async () => {
      calls += 1;
      return { schemaVersion: 1, brands: [{ id: 'acme', name: 'Acme', file: '../secret.json' }] };
    };
    await assert.rejects(loadCatalog(base, fetchJson), CatalogError);
    assert.equal(calls, 1);
  });
});

describe('настоящий каталог site/data', () => {
  const readJson = async (url) => JSON.parse(await readFile(url, 'utf8'));
  const dataUrl = pathToFileURL(join(SITE_ROOT, 'data') + '/');

  test('проходит проверку схемы', async () => {
    const catalog = await loadCatalog(dataUrl, readJson);
    assert.ok(catalog.brands.length > 0, 'нет брендов');
    assert.ok(catalog.enclosures.length > 0, 'нет корпусов');
    assert.ok(catalog.devices.length > 0, 'нет устройств');
  });

  test('подтверждённые позиции имеют ссылку на источник', async () => {
    const catalog = await loadCatalog(dataUrl, readJson);
    const missing = [...catalog.enclosures, ...catalog.devices].filter((i) => i.verified && !i.source).map((i) => i.id);
    assert.deepEqual(missing, []);
  });
});
