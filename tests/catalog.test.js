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
  COMB_DEVICE_CATEGORIES,
} from '../site/js/catalog.js';
import { SITE_ROOT } from '../tools/serve.js';
import { seriesMatch } from '../site/js/checks.js';

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
      mcb({ id: 'acme-n', category: 'terminal', modules: 2, specs: { role: 'N', clamps: [[2, 25], [7, 16]] } }),
      mcb({ id: 'acme-pe', category: 'terminal', modules: 1.5, specs: { role: 'PE' } }),
      mcb({ id: 'acme-db', category: 'distribution', modules: 4, specs: { poles: '1P+N', ratedCurrentA: 63, clamps: [[2, 16], [6, 10]] } }),
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

  test('держатели и клеммы N/PE (terminalCarriers, terminalInserts) и комплектация корпуса', () => {
    const carrier = (over = {}) => ({ id: 'acme-c', brand: 'acme', kind: 'carrier', article: 'C1', lengthMm: 240, positions: ['top', 'bottom'], verified: false, ...over });
    const insert = (over = {}) => ({ id: 'acme-n6', brand: 'acme', role: 'N', article: 'N6', clamps: [[1, 16], [5, 4]], widthMm: 30, color: 'blue', carrierIds: ['acme-c'], verified: false, ...over });
    const setup = { carriers: [{ carrierId: 'acme-c', position: 'top', included: true, inserts: [{ insertId: 'acme-n6', pos: 0, included: true }] }], verified: false };
    const ok = (over) => assert.deepEqual(validateBrandFile(brandFile({ terminalCarriers: [carrier()], terminalInserts: [insert()], ...over })), []);
    ok({});
    ok({ enclosures: [enclosure({ terminalSetup: setup })] });
    ok({ terminalInserts: [insert({ role: 'universal', color: undefined }), insert({ id: 'acme-f', article: undefined, fixed: true })].map((x) => JSON.parse(JSON.stringify(x))) });
    const bad = (over, fragment) => hasError(validateBrandFile(brandFile({ terminalCarriers: [carrier()], terminalInserts: [insert()], ...over })), fragment);
    bad({ terminalCarriers: [carrier({ kind: 'rail' })] }, 'terminalCarriers[0].kind');
    bad({ terminalCarriers: [carrier({ positions: ['left'] })] }, 'terminalCarriers[0].positions');
    bad({ terminalCarriers: [carrier({ positions: [] })] }, 'terminalCarriers[0].positions');
    bad({ terminalCarriers: [carrier({ lengthMm: 0 })] }, 'terminalCarriers[0].lengthMm');
    ok({ terminalCarriers: [carrier({ color: 'white' })] });
    bad({ terminalCarriers: [carrier({ color: 'pink' })] }, 'terminalCarriers[0].color');
    ok({ terminalCarriers: [carrier({ pitchMm: 30 })] });
    bad({ terminalCarriers: [carrier({ pitchMm: 0 })] }, 'terminalCarriers[0].pitchMm');
    bad({ terminalInserts: [insert({ role: 'holder' })] }, 'terminalInserts[0].role');
    bad({ terminalInserts: [insert({ widthMm: -1 })] }, 'terminalInserts[0].widthMm');
    bad({ terminalInserts: [insert({ color: 'pink' })] }, 'terminalInserts[0].color');
    bad({ terminalInserts: [insert({ clamps: [] })] }, 'terminalInserts[0].clamps');
    bad({ enclosures: [enclosure({ terminalSetup: { ...setup, carriers: [{ ...setup.carriers[0], position: 'left' }] } })] }, 'terminalSetup: carriers: [0].position');
    bad({ enclosures: [enclosure({ terminalSetup: { ...setup, carriers: [{ ...setup.carriers[0], inserts: [{ insertId: 'acme-n6', pos: -1 }] }] } })] }, 'pos: нужно число');
    bad({ enclosures: [enclosure({ terminalSetup: { carriers: [] } })] }, 'terminalSetup: verified: обязательное поле');
    bad({ enclosures: [enclosure({ terminals: { included: true, verified: false } })] }, 'enclosures[0].terminals: неизвестное поле');
  });

  test('ссылки держателей и клемм: корпуса, держатели, клеммы существуют; заводские клеммы помещаются', () => {
    const enc = (terminalSetup) => ({ ...enclosure(), terminalSetup });
    const cat = (over = {}) => ({
      enclosures: [enc({ carriers: [{ carrierId: 'acme-c', position: 'top', included: true, inserts: [{ insertId: 'acme-n6', pos: 0 }, { insertId: 'acme-n6', pos: 30 }] }], verified: false })],
      devices: [],
      terminalCarriers: [{ id: 'acme-c', brand: 'acme', lengthMm: 60, positions: ['top'], enclosureIds: ['acme-box-12'] }],
      terminalInserts: [{ id: 'acme-n6', brand: 'acme', role: 'N', widthMm: 30, carrierIds: ['acme-c'] }],
      ...over,
    });
    assert.deepEqual(validateCatalog(cat()), []);
    const has = (c, fragment) => assert.ok(validateCatalog(c).some((e) => e.includes(fragment)), `${fragment}: ${validateCatalog(c)}`);
    has(cat({ terminalCarriers: [{ id: 'acme-c', brand: 'acme', lengthMm: 50, positions: ['top'], enclosureIds: ['acme-box-12'] }] }), '"acme-n6" не помещается');
    has(cat({ terminalCarriers: [{ id: 'acme-c', brand: 'acme', lengthMm: 60, positions: ['bottom'] }] }), 'место "top" не подходит');
    has(cat({ terminalCarriers: [{ id: 'acme-c', brand: 'acme', lengthMm: 60, positions: ['top'], enclosureIds: ['acme-other'] }] }), 'нет корпуса "acme-other"');
    has(cat({ terminalInserts: [{ id: 'acme-n6', brand: 'acme', role: 'N', widthMm: 30, carrierIds: ['acme-x'] }] }), 'нет держателя "acme-x"');
    has(cat({ terminalInserts: [] }), 'нет клеммы "acme-n6"');
    has(cat({ enclosures: [enc({ carriers: [{ carrierId: 'acme-y', included: true }], verified: false })] }), 'нет держателя "acme-y"');
    const overlap = enc({ carriers: [{ carrierId: 'acme-c', position: 'top', included: true, inserts: [{ insertId: 'acme-n6', pos: 0 }, { insertId: 'acme-n6', pos: 20 }] }], verified: false });
    has(cat({ enclosures: [overlap] }), 'не помещается');
  });

  test('полюса УЗО — только 2P или 4P (единое правило для всех брендов)', () => {
    const rcd = (poles) => ({ ...mcb(), id: 'acme-rcd', article: 'R1', category: 'rcd', modules: 2, specs: { poles, ratedCurrentA: 40, sensitivityMa: 30, rcdType: 'A' } });
    assert.deepEqual(validateBrandFile(brandFile({ devices: [rcd('2P')] })), []);
    assert.deepEqual(validateBrandFile(brandFile({ devices: [rcd('4P')] })), []);
    hasError(validateBrandFile(brandFile({ devices: [rcd('1P+N')] })), 'specs.poles: ожидалось одно из: 2P, 4P');
    hasError(validateBrandFile(brandFile({ devices: [rcd('3P+N')] })), 'specs.poles: ожидалось одно из: 2P, 4P');
  });

  test('аксессуары гребёнок (combParts)', () => {
    const part = (over = {}) => ({ id: 'acme-cap', brand: 'acme', series: 'K', article: 'CAP', kind: 'end-cap', combSeries: ['K'], verified: false, ...over });
    assert.deepEqual(validateBrandFile(brandFile({ combParts: [part(), part({ id: 'acme-f', article: 'F', kind: 'feed-terminal', packQty: 4 })] })), []);
    hasError(validateBrandFile(brandFile({ combParts: [part({ kind: 'clip' })] })), 'combParts[0].kind');
    hasError(validateBrandFile(brandFile({ combParts: [part({ combSeries: [] })] })), 'combParts[0].combSeries');
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

  test('гребёнки: хотя бы одна из указанных серий есть среди аппаратов бренда (с учётом написания)', async () => {
    const catalog = await loadCatalog(dataUrl, readJson);
    const series = (brand) => [...new Set(catalog.devices.filter((d) => d.brand === brand && COMB_DEVICE_CATEGORIES.has(d.category)).map((d) => d.series))];
    // Гребёнки для аппаратов, которых в каталоге нет (не ошибка написания)
    const notInCatalog = new Set(['KDN463BZ']); // Hager ARF — устройства защиты от дугового пробоя
    const lost = catalog.combs
      .filter((comb) => comb.deviceSeries && series(comb.brand).length && !notInCatalog.has(comb.article))
      .filter((comb) => !series(comb.brand).some((s) => seriesMatch(s, comb.deviceSeries)))
      .map((comb) => `${comb.article}: ${comb.deviceSeries.join(', ')}`);
    assert.deepEqual(lost, []);
  });

  test('размеры клемм держателя («−» / «+»): у одного держателя нет двух клемм одной роли и серии с одинаковым числом клемм', async () => {
    const catalog = await loadCatalog(dataUrl, readJson);
    const count = (clamps) => clamps.reduce((s, [n]) => s + n, 0);
    const seen = new Map();
    const clashes = [];
    for (const x of catalog.terminalInserts.filter((i) => !i.fixed)) {
      for (const c of x.carrierIds ?? []) {
        const key = [c, x.role, x.series ?? '', count(x.clamps)].join('|');
        if (seen.has(key)) clashes.push(seen.get(key) + ' = ' + x.id + ' (' + key + ')');
        else seen.set(key, x.id);
      }
    }
    assert.deepEqual(clashes, []);
  });

  test('подтверждённые позиции имеют ссылку на источник', async () => {
    const catalog = await loadCatalog(dataUrl, readJson);
    const missing = [...catalog.enclosures, ...catalog.devices].filter((i) => i.verified && !i.source).map((i) => i.id);
    assert.deepEqual(missing, []);
  });
});
