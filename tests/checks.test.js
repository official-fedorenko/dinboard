import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { checkBoard, mainApparatus, spdFitsEarthing, terminalClamps, SPARE_SHARE } from '../site/js/checks.js';
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

describe('клеммники N/PE', () => {
  const withTerminals = (terminals) => ({ ...enclosure, terminals });
  const run = (terminals, ids, extra = {}) => {
    const enc = withTerminals(terminals);
    let board = createBoard(enc);
    for (const id of ids) ({ board } = addDevice(board, enc, devices, id));
    return checkBoard({ ...board, ...extra }, enc, devices);
  };
  const ids = ['sw2-63', 'rcd-63-a', ...Array(5).fill('mcb1-16')];

  test('terminalClamps: N и PE по блокам; общий блок N+PE и неизвестное число — null', () => {
    const t = { included: true, blocks: [{ role: 'N', clamps: [[2, 25], [11, 16]] }, { role: 'PE', clamps: [[3, 25]] }, { role: 'PE', clamps: [[2, 16]] }], verified: false };
    const board = createBoard(enclosure);
    assert.equal(terminalClamps(withTerminals(t), board, 'N'), 13);
    assert.equal(terminalClamps(withTerminals(t), board, 'PE'), 5);
    assert.equal(terminalClamps(withTerminals({ included: true, blocks: [{ role: 'N+PE', clamps: [[9, 16]] }], verified: false }), board, 'N'), null);
    assert.equal(terminalClamps(enclosure, board, 'N'), null);
    const acc = { included: false, accessories: [{ article: 'X', role: 'PE', clamps: [[7, 16]], verified: false }], verified: false };
    assert.equal(terminalClamps(withTerminals(acc), board, 'PE'), null, 'аксессуары не добавлены');
    assert.equal(terminalClamps(withTerminals(acc), { ...board, addTerminals: true }, 'PE'), 7);
  });

  test('не в комплекте и не добавлены — совет; добавлены — совета нет', () => {
    const t = { included: false, accessories: [{ article: 'X', role: 'PE', verified: false }], verified: false };
    assert.ok(run(t, ids).some((c) => c.key === 'check.noTerminals'));
    assert.ok(!run(t, ids, { addTerminals: true }).some((c) => c.key === 'check.noTerminals'));
    assert.ok(!run({ included: true, verified: false }, ids).some((c) => c.key === 'check.noTerminals'));
  });

  test('отходящих линий больше, чем клемм — совет по каждой роли', () => {
    // 5 автоматов = 5 линий; клемм N — 4, PE — 6
    const t = { included: true, blocks: [{ role: 'N', clamps: [[4, 16]] }, { role: 'PE', clamps: [[6, 16]] }], verified: false };
    const few = run(t, ids).filter((c) => c.key === 'check.fewClamps');
    assert.deepEqual(few, [{ level: 'info', key: 'check.fewClamps', params: { role: 'N', lines: 5, clamps: 4 } }]);
  });
});
