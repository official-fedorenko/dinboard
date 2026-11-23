import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  projectFromBoard,
  buildBoard,
  encodeLink,
  decodeLink,
  linkCodeFromHash,
  projectToFile,
  projectFromFile,
  projectFileName,
  createLocalStore,
  restoreProject,
  BACKUP_KEY,
  isEmptyProject,
  sameProject,
  ProjectError,
  STORAGE_KEY,
  LIMITS,
} from '../site/js/storage.js';
import { createBoard, addDevice, indexById } from '../site/js/board.js';

const enclosures = indexById([
  { id: 'hager-va24b', article: 'VA24B', rows: 2, modulesPerRow: 12 },
  { id: 'hager-va12b', article: 'VA12B', rows: 1, modulesPerRow: 12 },
]);
const devices = indexById([
  { id: 'hager-mcn116', article: 'MCN116', modules: 1 },
  { id: 'hager-cda240j', article: 'CDA240J', modules: 2 },
  { id: 'hager-spe440', article: 'SPE440', modules: 4 },
]);

const project = {
  enclosureId: 'hager-va24b',
  rows: [
    ['hager-cda240j', 'hager-mcn116', 'hager-mcn116', 'hager-mcn116'],
    ['hager-spe440'],
  ],
};

// Тот же проект, как его возвращает projectFromBoard: устройства подряд
const placed = { ...project, positions: [[0, 2, 3, 4], [0]] };

const failsWith = (fn, code, reason) =>
  assert.throws(
    fn,
    (err) => err instanceof ProjectError && err.code === code && (reason === undefined || err.details.reason === reason),
    `ожидалась ошибка ${code}${reason ? `/${reason}` : ''}`,
  );

describe('проект и щит', () => {
  test('щит → проект → щит', () => {
    const { board, skipped } = buildBoard(project, enclosures, devices);
    assert.deepEqual(skipped, []);
    assert.deepEqual(projectFromBoard(board), placed, 'без позиций (старый формат) — подряд');
    assert.equal(board.nextUid, 6, 'uid созданы заново');
  });

  test('неизвестный корпус — ошибка, неизвестные устройства — пропускаются', () => {
    failsWith(() => buildBoard({ ...project, enclosureId: 'abb-nope' }, enclosures, devices), 'enclosure');
    const { board, skipped } = buildBoard({ enclosureId: 'hager-va12b', rows: [['hager-mcn116', 'gone-device', 'hager-mcn116']] }, enclosures, devices);
    assert.deepEqual(skipped, ['gone-device']);
    assert.deepEqual(projectFromBoard(board).rows, [['hager-mcn116', 'hager-mcn116']]);
  });

  test('не помещается — ошибка no-space (лишний ряд или переполнение ряда)', () => {
    failsWith(() => buildBoard({ enclosureId: 'hager-va12b', rows: [[], []] }, enclosures, devices), 'no-space');
    const overfull = { enclosureId: 'hager-va12b', rows: [Array(4).fill('hager-spe440')] };
    failsWith(() => buildBoard(overfull, enclosures, devices), 'no-space');
  });

  test('проверка вида: id, ряды, лимиты, имена из прототипа', () => {
    for (const bad of [
      null,
      [],
      { enclosureId: 'Bad Id', rows: [[]] },
      { enclosureId: 'hager-va24b' },
      { enclosureId: 'hager-va24b', rows: [] },
      { enclosureId: 'hager-va24b', rows: [['hager-mcn116', 5]] },
      { enclosureId: 'hager-va24b', rows: Array(LIMITS.rows + 1).fill([]) },
      { enclosureId: 'hager-va24b', rows: [Array(LIMITS.itemsPerRow + 1).fill('hager-mcn116')] },
      { enclosureId: 'x'.repeat(LIMITS.idLength + 1), rows: [[]] },
    ]) {
      failsWith(() => buildBoard(bad, enclosures, devices), 'format');
    }
    // '__proto__' и 'constructor' не проходят как id (в id только [a-z0-9-])
    failsWith(() => buildBoard({ enclosureId: '__proto__', rows: [[]] }, enclosures, devices), 'format');
    failsWith(() => buildBoard({ enclosureId: 'constructor', rows: [[]] }, enclosures, devices), 'enclosure');
  });

  test('пустота и сравнение', () => {
    assert.equal(isEmptyProject({ enclosureId: 'hager-va24b', rows: [[], []] }), true);
    assert.equal(isEmptyProject(project), false);
    assert.equal(isEmptyProject(null), true);
    assert.equal(sameProject(project, structuredClone(project)), true);
    assert.equal(sameProject(project, { ...project, enclosureId: 'hager-va12b' }), false);
  });
});

describe('система заземления в проекте', () => {
  const withEarthing = { ...project, earthing: 'TT' };

  test('щит → проект → щит, ссылка и файл сохраняют систему заземления', () => {
    const { board } = buildBoard(withEarthing, enclosures, devices);
    assert.equal(board.earthing, 'TT');
    assert.deepEqual(projectFromBoard(board), { ...placed, earthing: 'TT' });
    assert.deepEqual(decodeLink(encodeLink(withEarthing)), withEarthing);
    assert.deepEqual(projectFromFile(projectToFile(withEarthing, enclosures, devices)), withEarthing);
  });

  test('без системы заземления — поле отсутствует (старые ссылки и файлы открываются)', () => {
    const { board } = buildBoard(project, enclosures, devices);
    assert.equal(board.earthing, null);
    assert.equal('earthing' in projectFromBoard(board), false);
    assert.equal('g' in JSON.parse(Buffer.from(encodeLink(project), 'base64url').toString()), false);
  });

  test('неизвестная система заземления — ошибка format', () => {
    failsWith(() => buildBoard({ ...project, earthing: 'IT' }, enclosures, devices), 'format', 'earthing');
    const code = Buffer.from(JSON.stringify({ v: 1, e: 'hager-va24b', d: [], r: [[], []], g: '__proto__' })).toString('base64url');
    failsWith(() => decodeLink(code), 'format', 'earthing');
  });
});

describe('держатели клемм N/PE в проекте (carriers)', () => {
  const carriers = [
    { carrierId: 'hager-vz711', position: 'bottom', included: false, inserts: [{ insertId: 'kn14n', pos: 0 }, { insertId: 'kl', pos: 67.2, role: 'PE' }] },
    { carrierId: 'plate', position: 'top', included: true, inserts: [{ insertId: 'plate-n', pos: 0, included: true }] },
  ];
  const withCarriers = { ...project, carriers };
  const catalog = {
    carriersById: indexById([
      { id: 'hager-vz711', lengthMm: 240, positions: ['top', 'bottom'] },
      { id: 'plate', lengthMm: 270, positions: ['top'] },
    ]),
    insertsById: indexById([
      { id: 'kn14n', role: 'N', widthMm: 60, carrierIds: ['hager-vz711'] },
      { id: 'kl', role: 'universal', widthMm: 120 },
      { id: 'plate-n', role: 'N', widthMm: 130, carrierIds: ['plate'], fixed: true },
    ]),
  };
  const linkData = (p) => JSON.parse(Buffer.from(encodeLink(p), 'base64url').toString());

  test('щит → проект → щит, ссылка и файл сохраняют держатели и клеммы', () => {
    // Колодка — из комплектации корпуса (иначе «в комплекте корпуса» не сохранится)
    const encs = indexById([{ ...enclosures.get('hager-va24b'), terminalSetup: { carriers: [carriers[1]], verified: false } }]);
    const { board, skipped } = buildBoard(withCarriers, encs, devices, catalog);
    assert.deepEqual(skipped, []);
    assert.deepEqual(board.carriers, carriers);
    assert.deepEqual(projectFromBoard(board), { ...placed, carriers });
    assert.deepEqual(decodeLink(encodeLink(withCarriers)), withCarriers);
    assert.deepEqual(linkData(withCarriers).n[0], ['hager-vz711', 'bottom', 0, [['kn14n', 0, 0, 0], ['kl', 67.2, 'PE', 0]]], 'краткая запись в ссылке');
    assert.deepEqual(projectFromFile(projectToFile(withCarriers, enclosures, devices)), withCarriers);
    const none = { ...project, carriers: [] };
    assert.deepEqual(decodeLink(encodeLink(none)), none, 'все держатели убраны — пустой список сохраняется');
  });

  test('без поля — как с завода; старый флаг addTerminals принимается и не используется', () => {
    const encs = indexById([{ ...enclosures.get('hager-va24b'), terminalSetup: { carriers: [carriers[1]], verified: false } }]);
    assert.deepEqual(buildBoard(project, encs, devices, catalog).board.carriers, [carriers[1]]);
    assert.deepEqual(buildBoard({ ...project, carriers: [] }, encs, devices, catalog).board.carriers, [], 'убранные не возвращаются');
    const { board } = buildBoard({ ...project, addTerminals: true }, enclosures, devices);
    assert.equal('addTerminals' in board, false);
    const old = Buffer.from(JSON.stringify({ v: 1, e: 'hager-va24b', d: [], r: [[], []], t: 1 })).toString('base64url');
    assert.doesNotThrow(() => decodeLink(old));
    assert.equal('n' in linkData(project), false);
  });

  test('держатели и клеммы не из каталога или не на своём месте — пропускаются', () => {
    const odd = [
      { carrierId: 'gone', position: 'top', included: false, inserts: [] },
      { carrierId: 'plate', position: 'bottom', included: false, inserts: [{ insertId: 'kn14n', pos: 0 }, { insertId: 'nope', pos: 0 }, { insertId: 'kl', pos: 100 }, { insertId: 'kl', pos: 200 }] },
    ];
    const { board, skipped } = buildBoard({ ...project, carriers: odd }, enclosures, devices, catalog);
    assert.deepEqual(board.carriers, [{ carrierId: 'plate', position: 'top', included: false, inserts: [{ insertId: 'kl', pos: 100 }] }]);
    assert.deepEqual(skipped, ['gone', 'kn14n', 'nope', 'kl']);
  });

  test('«в комплекте корпуса» — только по комплектации корпуса, а не по флагу в ссылке или файле', () => {
    const factory = { carrierId: 'plate', position: 'top', included: true, inserts: [{ insertId: 'plate-n', pos: 0, included: true }] };
    const encs = indexById([{ ...enclosures.get('hager-va24b'), terminalSetup: { carriers: [factory], verified: false } }]);
    const forged = [
      { carrierId: 'hager-vz711', position: 'top', included: true, inserts: [{ insertId: 'kn14n', pos: 0, included: true }] },
      // Заводская колодка переставлена вниз, её шина сдвинута — всё равно из коробки
      { carrierId: 'plate', position: 'top', included: false, inserts: [{ insertId: 'plate-n', pos: 20 }] },
    ];
    const { board } = buildBoard({ ...project, carriers: forged }, encs, devices, catalog);
    assert.deepEqual(board.carriers, [
      { carrierId: 'hager-vz711', position: 'top', included: false, inserts: [{ insertId: 'kn14n', pos: 0 }] },
      { carrierId: 'plate', position: 'top', included: true, inserts: [{ insertId: 'plate-n', pos: 20, included: true }] },
    ]);
    // Две одинаковые колодки в проекте, а с завода одна — заводская только первая
    const twice = buildBoard({ ...project, carriers: [factory, factory] }, encs, devices, catalog).board.carriers;
    assert.deepEqual(twice.map((c) => [c.included, c.inserts.map((x) => Boolean(x.included))]), [[true, [true]], [false, [false]]]);
  });

  test('неверный вид — ошибка format', () => {
    const bad = (c) => failsWith(() => buildBoard({ ...project, carriers: c }, enclosures, devices), 'format', 'carriers');
    bad('x');
    bad([{ carrierId: 'a', position: 'left', included: false, inserts: [] }]);
    bad([{ carrierId: 'a', position: 'top', inserts: [] }]);
    bad([{ carrierId: 'a', position: 'top', included: false, inserts: [{ insertId: 'b', pos: -1 }] }]);
    bad([{ carrierId: 'a', position: 'top', included: false, inserts: [{ insertId: 'b', pos: 0, role: 'L' }] }]);
    bad([{ carrierId: 'a', position: 'top', included: false, inserts: [{ insertId: 'b', pos: 0, x: 1 }] }]);
    bad(Array.from({ length: LIMITS.carriers + 1 }, () => ({ carrierId: 'a', position: 'top', included: false, inserts: [] })));
    const code = Buffer.from(JSON.stringify({ v: 1, e: 'hager-va24b', d: [], r: [[], []], n: [['a', 'top', 2, []]] })).toString('base64url');
    failsWith(() => decodeLink(code), 'format', 'carriers');
  });
});

describe('гребёнки рядов в проекте', () => {
  const withCombs = { ...project, combs: ['hager-kdn163a', null] };

  test('щит → проект → щит, ссылка и файл сохраняют гребёнки', () => {
    const { board } = buildBoard(withCombs, enclosures, devices);
    assert.deepEqual(board.combs, ['hager-kdn163a', null]);
    assert.deepEqual(projectFromBoard(board), { ...placed, combs: ['hager-kdn163a', null] });
    assert.deepEqual(decodeLink(encodeLink(withCombs)), withCombs);
    assert.deepEqual(projectFromFile(projectToFile(withCombs, enclosures, devices)), withCombs);
  });

  test('без гребёнок — поля нет; неверный вид — ошибка format', () => {
    assert.equal('combs' in projectFromBoard(buildBoard(project, enclosures, devices).board), false);
    for (const combs of [['x'], [null, null], ['bad id', null], 'x']) {
      failsWith(() => buildBoard({ ...project, combs }, enclosures, devices), 'format', 'combs');
    }
  });
});

describe('аксессуары гребёнок в проекте', () => {
  const withParts = { ...project, combParts: { 'hager-kzn023': 2 } };

  test('щит → проект → щит, ссылка и файл сохраняют количество', () => {
    const { board } = buildBoard(withParts, enclosures, devices);
    assert.deepEqual(board.combParts, { 'hager-kzn023': 2 });
    assert.deepEqual(projectFromBoard(board), { ...placed, combParts: { 'hager-kzn023': 2 } });
    assert.deepEqual(decodeLink(encodeLink(withParts)), withParts);
    assert.deepEqual(projectFromFile(projectToFile(withParts, enclosures, devices)), withParts);
  });

  test('неверный вид — ошибка format', () => {
    for (const combParts of [{}, { 'hager-kzn023': 0 }, { 'hager-kzn023': 100 }, { 'Bad Id': 1 }, ['x'], 'x']) {
      failsWith(() => buildBoard({ ...project, combParts }, enclosures, devices), 'format', 'combParts');
    }
  });
});

describe('позиции устройств (свободная расстановка)', () => {
  const spaced = {
    enclosureId: 'hager-va24b',
    rows: [['hager-mcn116', 'hager-cda240j'], ['hager-spe440']],
    positions: [[3, 9.5], [8]],
  };

  test('щит → проект → щит: пустые места между устройствами сохраняются', () => {
    const { board } = buildBoard(spaced, enclosures, devices);
    assert.deepEqual(board.rows.map((r) => r.map((i) => i.pos)), [[3, 9.5], [8]]);
    assert.deepEqual(projectFromBoard(board), spaced);
  });

  test('ссылка и файл сохраняют позиции', () => {
    assert.deepEqual(JSON.parse(Buffer.from(encodeLink(spaced), 'base64url').toString()).p, [[3, 9.5], [8]]);
    assert.deepEqual(decodeLink(encodeLink(spaced)), spaced);
    const text = projectToFile(spaced, enclosures, devices);
    assert.deepEqual(JSON.parse(text).rows[0][1], { id: 'hager-cda240j', article: 'CDA240J', pos: 9.5 });
    assert.deepEqual(projectFromFile(text), spaced);
  });

  test('старые ссылки и файлы без позиций открываются — устройства подряд', () => {
    const oldLink = Buffer.from(JSON.stringify({ v: 1, e: 'hager-va24b', d: ['hager-mcn116'], r: [[0, 0], []] })).toString('base64url');
    const fromLink = decodeLink(oldLink);
    assert.equal('positions' in fromLink, false);
    assert.deepEqual(projectFromBoard(buildBoard(fromLink, enclosures, devices).board).positions, [[0, 1], []]);
    const oldFile = JSON.stringify({ app: 'dinboard', version: 1, enclosure: { id: 'hager-va12b' }, rows: [[{ id: 'hager-cda240j' }, { id: 'hager-mcn116' }]] });
    assert.deepEqual(projectFromBoard(buildBoard(projectFromFile(oldFile), enclosures, devices).board).positions, [[0, 2]]);
  });

  test('неизвестное устройство пропускается, соседи остаются на своих местах', () => {
    const p = { enclosureId: 'hager-va12b', rows: [['hager-mcn116', 'gone-device', 'hager-mcn116']], positions: [[0, 4, 10]] };
    const { board, skipped } = buildBoard(p, enclosures, devices);
    assert.deepEqual(skipped, ['gone-device']);
    assert.deepEqual(projectFromBoard(board).positions, [[0, 10]]);
  });

  test('место не подходит (ширина в каталоге изменилась) — на первое свободное место ряда', () => {
    // УЗО (2 модуля) с 0 задевает автомат с 1: УЗО (первое) на месте, автомат — на первое свободное
    const p = { enclosureId: 'hager-va12b', rows: [['hager-cda240j', 'hager-mcn116']], positions: [[0, 1]] };
    const { board } = buildBoard(p, enclosures, devices);
    assert.deepEqual(board.rows[0].map((i) => `${i.deviceId}@${i.pos}`), ['hager-cda240j@0', 'hager-mcn116@2']);
    // За краем рейки (12 модулей) — тоже на свободное место
    const far = buildBoard({ enclosureId: 'hager-va12b', rows: [['hager-spe440']], positions: [[30]] }, enclosures, devices).board;
    assert.deepEqual(far.rows[0].map((i) => i.pos), [0]);
  });

  test('испорченные позиции — ошибка format', () => {
    for (const positions of [[[0, 1]], [[0], []], [[0]], [[-1], [0]], [[0.3], [0]], [['1'], [0]], [[37], [0]], 'x']) {
      const bad = { enclosureId: 'hager-va24b', rows: [['hager-mcn116'], ['hager-mcn116']], positions };
      failsWith(() => buildBoard(bad, enclosures, devices), 'format', 'positions');
    }
    const mixed = JSON.stringify({
      app: 'dinboard',
      version: 1,
      enclosure: { id: 'hager-va12b' },
      rows: [[{ id: 'hager-mcn116', pos: 0 }, { id: 'hager-mcn116' }]],
    });
    failsWith(() => projectFromFile(mixed), 'format', 'positions');
    const link = Buffer.from(JSON.stringify({ v: 1, e: 'hager-va12b', d: ['hager-mcn116'], r: [[0]], p: [[0, 1]] })).toString('base64url');
    failsWith(() => decodeLink(link), 'format', 'positions');
  });
});

describe('ссылка', () => {
  test('туда и обратно; повторы id сжимаются словарём', () => {
    const code = encodeLink(project);
    assert.match(code, /^[A-Za-z0-9_-]+$/, 'только символы base64url');
    assert.deepEqual(decodeLink(code), project);
    const json = JSON.parse(Buffer.from(code, 'base64url').toString('utf8'));
    assert.deepEqual(json.d, ['hager-cda240j', 'hager-mcn116', 'hager-spe440']);
    assert.deepEqual(json.r, [[0, 1, 1, 1], [2]]);
  });

  test('ссылка на полный 4-рядный щит короткая', () => {
    const big = { enclosureId: 'hager-va48b', rows: Array.from({ length: 4 }, () => Array(12).fill('hager-mcn116')) };
    assert.ok(encodeLink(big).length < 400);
  });

  test('испорченные ссылки — ошибка format', () => {
    const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    for (const bad of [
      '',
      '!!!',
      'a'.repeat(LIMITS.linkLength + 1),
      Buffer.from('не json').toString('base64url'),
      Buffer.from([0xff, 0xfe]).toString('base64url'),
      enc({ v: 2, e: 'hager-va24b', d: [], r: [[]] }),
      enc({ v: 1, e: 'hager-va24b', d: ['ok-id'], r: [[1]] }),
      enc({ v: 1, e: 'hager-va24b', d: ['ok-id'], r: [[-1]] }),
      enc({ v: 1, e: 'hager-va24b', d: ['<script>'], r: [[0]] }),
      enc({ v: 1, e: 'hager-va24b', d: [], r: 'x' }),
      enc({ v: 1, e: 'hager-va24b', d: [], r: [] }),
    ]) {
      failsWith(() => decodeLink(bad), 'format');
    }
  });

  test('код из адреса страницы', () => {
    assert.equal(linkCodeFromHash('#b=abc'), 'abc');
    assert.equal(linkCodeFromHash('#other'), null);
    assert.equal(linkCodeFromHash(''), null);
  });
});

describe('файл проекта', () => {
  test('туда и обратно, с артикулами для человека', () => {
    const text = projectToFile(project, enclosures, devices, new Date('2026-11-15T10:00:00Z'));
    const data = JSON.parse(text);
    assert.equal(data.app, 'dinboard');
    assert.equal(data.savedAt, '2026-11-15T10:00:00.000Z');
    assert.deepEqual(data.enclosure, { id: 'hager-va24b', article: 'VA24B' });
    assert.deepEqual(data.rows[1], [{ id: 'hager-spe440', article: 'SPE440' }]);
    assert.deepEqual(projectFromFile(text), project);
  });

  test('чужие и испорченные файлы — ошибка format', () => {
    for (const bad of [
      'не json',
      JSON.stringify({ app: 'other', version: 1, enclosure: { id: 'hager-va24b' }, rows: [[]] }),
      JSON.stringify({ app: 'dinboard', version: 9, enclosure: { id: 'hager-va24b' }, rows: [[]] }),
      JSON.stringify({ app: 'dinboard', version: 1, enclosure: 'hager-va24b', rows: [[]] }),
      JSON.stringify({ app: 'dinboard', version: 1, enclosure: { id: 'hager-va24b' }, rows: [['hager-mcn116']] }),
      ' '.repeat(LIMITS.textLength + 1),
    ]) {
      failsWith(() => projectFromFile(bad), 'format');
    }
  });

  test('имя файла', () => {
    assert.equal(projectFileName({ article: 'VA24B' }, new Date('2026-11-15T10:00:00Z')), 'dinboard-va24b-2026-11-15.json');
    assert.equal(projectFileName({ article: '../../etc/passwd' }, new Date('2026-11-15T10:00:00Z')), 'dinboard--etc-passwd-2026-11-15.json');
  });
});

describe('хранилище браузера', () => {
  const memory = () => {
    const data = new Map();
    return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), data };
  };

  test('сохраняет и читает, резервная копия — отдельным ключом', () => {
    const storage = memory();
    const store = createLocalStore(storage, enclosures, devices);
    assert.equal(store.loadText(), null);
    assert.equal(store.save(project), true);
    assert.ok(storage.data.get(STORAGE_KEY).includes('"app": "dinboard"'));
    assert.deepEqual(projectFromFile(store.loadText()), project);
    assert.equal(store.saveBackup('прежняя версия'), true);
    assert.equal(storage.data.get(BACKUP_KEY), 'прежняя версия');
    assert.notEqual(BACKUP_KEY, STORAGE_KEY);
  });

  test('резервная копия читается после перезагрузки и удаляется', () => {
    const storage = { ...memory(), removeItem(k) { this.data.delete(k); } };
    storage.data = new Map();
    storage.getItem = (k) => storage.data.get(k) ?? null;
    storage.setItem = (k, v) => storage.data.set(k, String(v));
    const store = createLocalStore(storage, enclosures, devices);
    assert.equal(store.loadBackup(), null);
    store.saveBackup('прежняя версия');
    assert.equal(createLocalStore(storage, enclosures, devices).loadBackup(), 'прежняя версия', 'новый запуск видит копию');
    assert.equal(store.clearBackup(), true);
    assert.equal(store.loadBackup(), null);
    const throwing = { getItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
    assert.equal(createLocalStore(throwing, enclosures, devices).loadBackup(), null);
    assert.equal(createLocalStore(throwing, enclosures, devices).clearBackup(), false);
  });

  test('недоступное хранилище не ломает работу; испорченный текст возвращается как есть', () => {
    const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
    const store = createLocalStore(throwing, enclosures, devices);
    assert.equal(store.loadText(), null);
    assert.equal(store.save(project), false);
    assert.equal(store.saveBackup('x'), false);
    assert.equal(createLocalStore(undefined, enclosures, devices).loadText(), null);
    const broken = memory();
    broken.setItem(STORAGE_KEY, '{oops');
    assert.equal(createLocalStore(broken, enclosures, devices).loadText(), '{oops', 'разбор и решение — в restoreProject');
  });
});

describe('restoreProject: восстановление при открытии страницы', () => {
  const fileText = (p) => projectToFile(p, enclosures, devices, new Date('2026-11-15T10:00:00Z'));
  const linkHash = (p) => `#b=${encodeLink(p)}`;
  const run = (opts) => {
    let asked = 0;
    const result = restoreProject({
      hash: '',
      localText: null,
      enclosures,
      devices,
      confirmLink: () => {
        asked += 1;
        return opts.answer ?? false;
      },
      ...opts,
    });
    return { ...result, asked, rows: result.board ? projectFromBoard(result.board).rows : null };
  };
  const keys = (r) => r.notices.map((n) => n.key);

  test('щит этапа 15 с добавленными клеммниками (addTerminals) — подсказка подобрать клеммы заново', () => {
    const old = { enclosureId: 'hager-va24b', rows: [['hager-mcn116'], []] };
    const code = Buffer.from(JSON.stringify({ v: 1, e: old.enclosureId, d: ['hager-mcn116'], r: [[0], []], t: 1 })).toString('base64url');
    assert.deepEqual(keys(run({ hash: '#b=' + code })), ['project.linkOpened', 'project.oldTerminals']);
    const file = JSON.stringify({ ...JSON.parse(fileText(old)), addTerminals: true });
    assert.deepEqual(keys(run({ localText: file })), ['project.oldTerminals']);
    assert.equal(buildBoard({ ...old, addTerminals: true }, enclosures, devices).oldTerminals, true);
    // Без флага или уже с держателями (сохранён после этапа 17) — без подсказки
    assert.deepEqual(keys(run({ localText: fileText(old) })), []);
    assert.equal(buildBoard({ ...old, addTerminals: true, carriers: [] }, enclosures, devices).oldTerminals, false);
  });

  test('старая ссылка (без позиций) на тот же щит, что сохранён (с позициями подряд), — без вопроса и копии', () => {
    const old = { enclosureId: 'hager-va24b', rows: [['hager-cda240j', 'hager-mcn116'], []] };
    const saved = { ...old, positions: [[0, 2], []] };
    const r = run({ hash: linkHash(old), localText: fileText(saved) });
    assert.equal(r.asked, 0);
    assert.deepEqual(keys(r), ['project.linkOpened']);
    assert.equal(r.backupText, null);
    // Тот же набор, но в сохранении устройства с промежутком — это другой щит
    const spaced = run({ hash: linkHash(old), localText: fileText({ ...old, positions: [[0, 5], []] }) });
    assert.equal(spaced.asked, 1);
  });

  test('в сохранении устройство не из каталога, ссылка совпадает с остальным щитом — вопрос и копия', () => {
    const local = { enclosureId: 'hager-va24b', rows: [['hager-mcn116', 'hager-gone'], []], positions: [[0, 1], []] };
    const link = { enclosureId: 'hager-va24b', rows: [['hager-mcn116'], []], positions: [[0], []] };
    const declined = run({ hash: linkHash(link), localText: fileText(local) });
    assert.equal(declined.asked, 1, 'иначе устройство молча теряется');
    const accepted = run({ hash: linkHash(link), localText: fileText(local), answer: true });
    assert.deepEqual(keys(accepted), ['project.linkOpenedBackup']);
    assert.equal(accepted.backupText, fileText(local));
  });

  test('одно и то же устройство не из каталога и в сохранении, и в ссылке — без вопроса, но с копией', () => {
    const same = { enclosureId: 'hager-va24b', rows: [['hager-mcn116', 'hager-gone'], []], positions: [[0, 1], []] };
    const r = run({ hash: linkHash(same), localText: fileText(same) });
    assert.equal(r.asked, 0);
    assert.deepEqual(keys(r), ['project.loadedSkipped', 'project.linkOpenedBackup']);
    assert.equal(r.backupText, fileText(same));
  });

  test('ничего нет — пустой старт без сообщений', () => {
    const r = run({});
    assert.equal(r.board, null);
    assert.deepEqual(r.notices, []);
    assert.equal(r.backupText, null);
  });

  test('своё сохранение подходит — открывается молча', () => {
    const r = run({ localText: fileText(project) });
    assert.deepEqual(r.rows, project.rows);
    assert.deepEqual(r.notices, []);
    assert.equal(r.backupText, null);
  });

  test('в своём сохранении есть устройство не из каталога — сообщение и резервная копия', () => {
    const text = fileText({ enclosureId: 'hager-va12b', rows: [['hager-mcn116', 'hager-old-device', 'hager-mcn116']] });
    const r = run({ localText: text });
    assert.deepEqual(r.rows, [['hager-mcn116', 'hager-mcn116']]);
    assert.deepEqual(r.notices, [{ key: 'project.localSkipped', params: { n: 1 } }]);
    assert.equal(r.backupText, text, 'исходный текст сохраняется до перезаписи');
  });

  test('своё сохранение не подходит (корпус не из каталога, испорчено) — сообщение и резервная копия', () => {
    for (const text of [fileText({ enclosureId: 'hager-va99x', rows: [['hager-mcn116']] }), '{oops']) {
      const r = run({ localText: text });
      assert.equal(r.board, null);
      assert.deepEqual(keys(r), ['project.localLost']);
      assert.equal(r.backupText, text);
    }
  });

  test('ссылка при пустом браузере — открывается без вопроса', () => {
    const r = run({ hash: linkHash(project) });
    assert.deepEqual(r.rows, project.rows);
    assert.equal(r.asked, 0);
    assert.deepEqual(keys(r), ['project.linkOpened']);
    assert.equal(r.backupText, null);
  });

  test('ссылка совпадает с сохранённым щитом — без вопроса', () => {
    const r = run({ hash: linkHash(project), localText: fileText(project) });
    assert.equal(r.asked, 0);
    assert.equal(r.backupText, null);
  });

  test('ссылка при другом сохранённом щите: отказ — свой щит; согласие — щит из ссылки и копия своего', () => {
    const local = { enclosureId: 'hager-va12b', rows: [['hager-mcn116']] };
    const declined = run({ hash: linkHash(project), localText: fileText(local), answer: false });
    assert.equal(declined.asked, 1);
    assert.deepEqual(declined.rows, local.rows);
    assert.equal(declined.backupText, null);

    const accepted = run({ hash: linkHash(project), localText: fileText(local), answer: true });
    assert.deepEqual(accepted.rows, project.rows);
    assert.deepEqual(keys(accepted), ['project.linkOpenedBackup']);
    assert.equal(accepted.backupText, fileText(local));
  });

  test('ссылка заменяет свой щит и в ней есть устройства не из каталога — оба сообщения', () => {
    const local = { enclosureId: 'hager-va12b', rows: [['hager-mcn116']] };
    const withUnknown = { enclosureId: 'hager-va24b', rows: [['hager-mcn116', 'gone-device'], []] };
    const r = run({ hash: linkHash(withUnknown), localText: fileText(local), answer: true });
    assert.deepEqual(r.notices, [
      { key: 'project.loadedSkipped', params: { n: 1 } },
      { key: 'project.linkOpenedBackup' },
    ]);
    assert.equal(r.backupText, fileText(local));
  });

  test('испорченная ссылка — сообщение, свой щит остаётся', () => {
    const r = run({ hash: '#b=%%%', localText: fileText(project) });
    assert.deepEqual(r.rows, project.rows);
    assert.deepEqual(keys(r), ['project.error.format']);
  });

  test('испорченная ссылка и неподходящее сохранение — оба сообщения', () => {
    const r = run({ hash: '#b=%%%', localText: '{oops' });
    assert.deepEqual(keys(r), ['project.error.format', 'project.localLost']);
    assert.equal(r.backupText, '{oops');
  });

  test('ссылка при испорченном сохранении — открывается, а испорченное уходит в копию', () => {
    const r = run({ hash: linkHash(project), localText: '{oops' });
    assert.deepEqual(r.rows, project.rows);
    assert.equal(r.asked, 0);
    assert.equal(r.backupText, '{oops');
  });
});
