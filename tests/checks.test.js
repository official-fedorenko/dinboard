import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { checkBoard, mainApparatus, spdFitsEarthing, seriesMatch, SPARE_SHARE } from '../site/js/checks.js';
import { createBoard, addDevice, setEarthing, indexById } from '../site/js/board.js';

const dev = (id, category, modules, specs) => ({ id, category, modules, specs });
const devices = indexById([
  dev('sw2-63', 'switch', 2, { poles: '2P', ratedCurrentA: 63 }),
  dev('sw4-40', 'switch', 4, { poles: '4P', ratedCurrentA: 40 }),
  dev('mcb1-16', 'mcb', 1, { poles: '1P', ratedCurrentA: 16, curve: 'C', breakingCapacityKa: 6 }),
  dev('mcb2-40', 'mcb', 2, { poles: '2P', ratedCurrentA: 40, curve: 'C', breakingCapacityKa: 6 }),
  dev('mcb3-25', 'mcb', 3, { poles: '3P', ratedCurrentA: 25, curve: 'C', breakingCapacityKa: 6 }),
  dev('rcd-40-a', 'rcd', 2, { poles: '2P', ratedCurrentA: 40, sensitivityMa: 30, rcdType: 'A' }),
  dev('rcd-25-ac', 'rcd', 2, { poles: '2P', ratedCurrentA: 25, sensitivityMa: 30, rcdType: 'AC' }),
  dev('rcd-63-a', 'rcd', 2, { poles: '2P', ratedCurrentA: 63, sensitivityMa: 30, rcdType: 'A' }),
  dev('rcbo-16-ac', 'rcbo', 2, { poles: '1P+N', ratedCurrentA: 16, curve: 'C', breakingCapacityKa: 6, sensitivityMa: 30, rcdType: 'AC' }),
  dev('spd-1n-tt', 'spd', 2, { poles: '1P+N', spdType: '2', networks: ['TN-S', 'TT'] }),
  dev('spd-3n-tns', 'spd', 4, { poles: '3P+N', spdType: '2', networks: ['TN-S'] }),
  dev('spd-3n-any', 'spd', 4, { poles: '3P+N', spdType: '2' }),
]);
const enclosure = { id: 'e', rows: 3, modulesPerRow: 12 };

function build(ids, earthing = null) {
  let board = createBoard(enclosure);
  for (const id of ids) ({ board } = addDevice(board, enclosure, devices, id));
  return setEarthing(board, earthing);
}
const keys = (ids, earthing) => checkBoard(build(ids, earthing), enclosure, devices).map((c) => c.key);
const find = (ids, key, earthing) => checkBoard(build(ids, earthing), enclosure, devices).find((c) => c.key === key);

describe('checkBoard', () => {
  test('пустой щит — без подсказок', () => {
    assert.deepEqual(checkBoard(createBoard(enclosure), enclosure, devices), []);
  });

  test('правильный однофазный щит — без замечаний', () => {
    assert.deepEqual(keys(['sw2-63', 'rcd-63-a', 'mcb1-16', 'mcb1-16']), []);
  });

  test('нет вводного аппарата и нет защиты от утечки', () => {
    const k = keys(['mcb1-16']);
    assert.ok(k.includes('check.noMain'));
    assert.ok(k.includes('check.noRcd'));
  });

  test('многополюсный автомат считается вводным, если рубильника нет', () => {
    assert.ok(!keys(['mcb2-40', 'rcd-40-a']).includes('check.noMain'));
  });

  test('дифавтомат тоже защищает от утечки', () => {
    assert.ok(!keys(['sw2-63', 'rcbo-16-ac']).includes('check.noRcd'));
  });

  test('УЗО меньше вводного аппарата — предупреждение по каждому номиналу один раз', () => {
    const list = checkBoard(build(['sw2-63', 'rcd-40-a', 'rcd-40-a', 'rcd-25-ac']), enclosure, devices).filter((c) => c.key === 'check.rcdBelowMain');
    assert.deepEqual(list.map((c) => c.params), [{ rcd: 25, main: 63 }, { rcd: 40, main: 63 }]);
    assert.equal(list[0].level, 'warning');
    assert.ok(!keys(['sw2-63', 'rcd-63-a']).includes('check.rcdBelowMain'));
    assert.ok(!keys(['sw2-63', 'rcbo-16-ac']).includes('check.rcdBelowMain'), 'дифавтомат сам защищён от перегрузки');
  });

  test('однофазный ввод и трёхфазные устройства', () => {
    assert.deepEqual(find(['sw2-63', 'rcd-63-a', 'mcb3-25', 'spd-3n-any'], 'check.threePhaseOnSingle').params, { n: 2 });
    assert.ok(!keys(['sw4-40', 'rcd-40-a', 'mcb3-25']).includes('check.threePhaseOnSingle'), 'трёхфазный ввод — нормально');
  });

  test('трёхфазный ввод и однофазный УЗИП', () => {
    assert.ok(keys(['sw4-40', 'rcd-40-a', 'spd-1n-tt']).includes('check.singlePhaseSpdOnThree'));
    assert.ok(!keys(['sw4-40', 'rcd-40-a', 'spd-3n-any']).includes('check.singlePhaseSpdOnThree'));
    assert.ok(
      !keys(['sw4-40', 'rcd-40-a', 'spd-3n-any', 'spd-1n-tt']).includes('check.singlePhaseSpdOnThree'),
      'есть трёхфазный УЗИП — все фазы защищены, однофазный в дополнение не ошибка',
    );
  });

  test('УЗИП и система заземления', () => {
    assert.ok(keys(['sw2-63', 'rcd-63-a', 'spd-1n-tt']).includes('check.spdNoEarthing'), 'не указана — подсказка');
    const bad = find(['sw4-40', 'rcd-40-a', 'spd-3n-tns'], 'check.spdEarthing', 'TT');
    assert.deepEqual(bad.params, { networks: 'TN-S', earthing: 'TT' });
    assert.equal(bad.deviceId, 'spd-3n-tns');
    assert.ok(!keys(['sw4-40', 'rcd-40-a', 'spd-3n-tns'], 'TN-C-S').includes('check.spdEarthing'), 'TN-C-S принимает УЗИП для TN-S');
    assert.ok(!keys(['sw4-40', 'rcd-40-a', 'spd-3n-any'], 'TT').includes('check.spdEarthing'), 'нет данных — не проверяем');
    assert.ok(!keys(['sw2-63', 'rcd-63-a', 'spd-1n-tt'], 'TT').includes('check.spdNoEarthing'));
  });

  test('тип AC — совет про тип A', () => {
    assert.deepEqual(find(['sw2-63', 'rcd-25-ac', 'rcbo-16-ac'], 'check.rcdTypeAC').params, { n: 2 });
    assert.equal(find(['sw2-63', 'rcd-25-ac'], 'check.rcdTypeAC').level, 'info');
  });

  test('мало свободных мест', () => {
    const one = { id: 'e1', rows: 1, modulesPerRow: 12 };
    let board = createBoard(one);
    for (const id of ['sw2-63', 'rcd-63-a', 'mcb1-16', 'mcb1-16', 'mcb1-16', 'mcb1-16', 'mcb1-16', 'mcb1-16']) {
      ({ board } = addDevice(board, one, devices, id));
    }
    // занято 10 из 12 — свободно 2 (17 %) < 20 %
    assert.deepEqual(checkBoard(board, one, devices).find((c) => c.key === 'check.lowSpare').params, { free: 2, percent: 17 });
    assert.equal(SPARE_SHARE, 0.2);
  });

  test('сначала предупреждения, потом советы', () => {
    const levels = checkBoard(build(['mcb1-16', 'rcd-25-ac']), enclosure, devices).map((c) => c.level);
    assert.deepEqual(levels, [...levels].sort((a, b) => (a === b ? 0 : a === 'warning' ? -1 : 1)));
  });
});

describe('вспомогательные', () => {
  test('mainApparatus: рубильник важнее автомата, берётся наибольший номинал', () => {
    assert.deepEqual(mainApparatus([devices.get('mcb2-40'), devices.get('sw2-63')]), { rating: 63, threePhase: false });
    assert.deepEqual(mainApparatus([devices.get('mcb2-40'), devices.get('mcb3-25')]), { rating: 40, threePhase: false });
    assert.deepEqual(mainApparatus([devices.get('sw4-40')]), { rating: 40, threePhase: true });
    assert.equal(mainApparatus([devices.get('mcb1-16')]), null);
  });

  test('spdFitsEarthing', () => {
    assert.equal(spdFitsEarthing(['TN-S', 'TT'], 'TT'), true);
    assert.equal(spdFitsEarthing(['TN-S'], 'TT'), false);
    assert.equal(spdFitsEarthing(['TN-S'], 'TN-C-S'), true);
    assert.equal(spdFitsEarthing(['TT'], 'TN-C-S'), false);
  });
});

describe('клеммы N/PE', () => {
  const carriersById = indexById([{ id: 'qc', brand: 'acme', lengthMm: 240, positions: ['top'], enclosureIds: [enclosure.id] }]);
  const insertsById = indexById([
    { id: 'n4', role: 'N', clamps: [[4, 16]], widthMm: 40 },
    { id: 'pe8', role: 'PE', clamps: [[8, 16]], widthMm: 60 },
  ]);
  const catalog = { carriersById, insertsById };
  const run = (carriers, ids) => {
    let board = createBoard(enclosure);
    for (const id of ids) ({ board } = addDevice(board, enclosure, devices, id));
    return checkBoard(carriers ? { ...board, carriers } : board, enclosure, devices, new Map(), catalog);
  };
  const ids = ['sw2-63', 'rcd-63-a', ...Array(5).fill('mcb1-16')];
  const one = [{ carrierId: 'qc', position: 'top', included: false, inserts: [{ insertId: 'n4', pos: 0 }, { insertId: 'pe8', pos: 40 }] }];

  test('держателей нет, а в корпус их можно поставить — совет; есть — совета нет', () => {
    assert.ok(run(null, ids).some((c) => c.key === 'check.noCarriers'));
    assert.ok(!run(one, ids).some((c) => c.key === 'check.noCarriers'));
    const noOptions = checkBoard(createBoard(enclosure), enclosure, devices, new Map(), { carriersById: new Map(), insertsById });
    assert.deepEqual(noOptions, []);
  });

  test('клемм меньше, чем линий и ввод, — совет по каждой роли', () => {
    // 5 автоматов = 5 линий + ввод = нужно по 6; клемм N — 4, PE — 8
    const few = run(one, ids).filter((c) => c.key === 'check.fewClamps');
    assert.deepEqual(few, [{ level: 'info', key: 'check.fewClamps', params: { role: 'N', need: 6, lines: 5, clamps: 4 } }]);
  });

  test('без каталога держателей клеммы не проверяются', () => {
    let board = createBoard(enclosure);
    for (const id of ids) ({ board } = addDevice(board, enclosure, devices, id));
    assert.ok(!checkBoard(board, enclosure, devices).some((c) => c.key.startsWith('check.noCarriers') || c.key === 'check.fewClamps'));
  });
});

describe('гребёнки', () => {
  const comb = { id: 'c', brand: 'acme', article: 'K1', phases: '1P', pinType: 'fork', lengthModules: 4, deviceSeries: ['S1'] };
  const combsById = new Map([[comb.id, comb]]);
  const devs = indexById([
    { id: 'a1', brand: 'acme', series: 'S1', category: 'mcb', modules: 1, specs: { poles: '1P', ratedCurrentA: 16, curve: 'C', breakingCapacityKa: 6 } },
    { id: 'a2', brand: 'acme', series: 'S2', category: 'mcb', modules: 2, specs: { poles: '2P', ratedCurrentA: 16, curve: 'C', breakingCapacityKa: 6 } },
    { id: 'b1', brand: 'other', series: 'S1', category: 'mcb', modules: 1, specs: { poles: '1P', ratedCurrentA: 16, curve: 'C', breakingCapacityKa: 6 } },
  ]);
  const run = (ids) => {
    let board = createBoard(enclosure);
    for (const id of ids) ({ board } = addDevice(board, enclosure, devs, id, { row: 0 }));
    return checkBoard({ ...board, combs: ['c', null, null] }, enclosure, devs, combsById).filter((c) => c.key.startsWith('check.comb'));
  };

  test('подходящая гребёнка — без замечаний', () => {
    assert.deepEqual(run(['a1', 'a1', 'a1']), []);
  });

  test('серия не из списка, полюсов больше, чем соединяет, гребёнка короче', () => {
    const list = run(['a1', 'a2', 'a1', 'a1']);
    assert.deepEqual(
      list.map((c) => [c.level, c.key, c.params]),
      [
        ['warning', 'check.combPhases', { row: 1, article: 'K1', phases: '1P', poles: '2P' }],
        ['info', 'check.combSeries', { row: 1, article: 'K1', series: 'S2' }],
        ['info', 'check.combShort', { row: 1, article: 'K1', length: 4, need: 5 }],
      ],
    );
  });

  test('аппарат другого производителя — предупреждение', () => {
    assert.deepEqual(run(['a1', 'b1']).map((c) => c.key), ['check.combBrand']);
  });

  test('без каталога гребёнок или без гребёнки — проверок нет', () => {
    let board = createBoard(enclosure);
    ({ board } = addDevice(board, enclosure, devs, 'a2', { row: 0 }));
    assert.deepEqual(checkBoard({ ...board, combs: ['c', null, null] }, enclosure, devs).filter((c) => c.key.startsWith('check.comb')), []);
  });
});

describe('гребёнки: серии пишутся по-разному в аппаратах и у гребёнок', () => {
  test('seriesMatch: iC60N ~ iC60, iCV40H ~ iCV40, AD ~ ADA, CD ~ CDA; MBN ≠ NBN', () => {
    assert.equal(seriesMatch('iC60N', ['iC60']), true);
    assert.equal(seriesMatch('iCV40H', ['iCV40']), true);
    assert.equal(seriesMatch('AD', ['ADA', 'ADC']), true);
    assert.equal(seriesMatch('CD', ['CDA']), true);
    assert.equal(seriesMatch('S200', ['S200', 'F200']), true);
    assert.equal(seriesMatch('MBN', ['NBN', 'NCN']), false);
    assert.equal(seriesMatch('F200', ['S200']), false);
  });
});
