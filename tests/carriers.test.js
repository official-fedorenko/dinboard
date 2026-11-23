import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  carrierGaps,
  canPlaceInsert,
  firstFreeInsertPos,
  snapInsertPos,
  addInsert,
  moveInsert,
  removeInsert,
  setInsertRole,
  setCarrierPosition,
  carrierClamps,
  clampsFor,
  autoFill,
  factoryCarriers,
  carrierOptions,
  insertOptions,
  addCarrier,
  removeCarrier,
  swapCarrier,
  clampNeed,
  CarrierError,
} from '../site/js/carriers.js';

const byId = (list) => new Map(list.map((x) => [x.id, x]));
const carriersById = byId([
  { id: 'c240', lengthMm: 240, positions: ['top', 'bottom'] },
  { id: 'c100', lengthMm: 100, positions: ['top'] },
]);
const insertsById = byId([
  { id: 'n6', role: 'N', clamps: [[1, 16], [5, 4]], widthMm: 30, carrierIds: ['c240', 'c100'] },
  { id: 'n14', role: 'N', clamps: [[2, 16], [12, 4]], widthMm: 60, carrierIds: ['c240', 'c100'] },
  { id: 'pe14', role: 'PE', clamps: [[2, 16], [12, 4]], widthMm: 60, carrierIds: ['c240'] },
  { id: 'kl', role: 'universal', clamps: [[2, 25], [13, 16]], widthMm: 120 },
  { id: 'npe', role: 'N+PE', clamps: [[24, 16]], widthMm: 200, carrierIds: ['c240'] },
]);
const empty = (carrierId = 'c240') => [{ carrierId, position: 'top', included: false, inserts: [] }];
const fails = (fn, code) => assert.throws(fn, (e) => e instanceof CarrierError && e.code === code, code);

describe('места в держателе', () => {
  test('промежутки, свободно ли, первое свободное', () => {
    let c = addInsert(empty(), 0, 'n6', carriersById, insertsById, { pos: 50 });
    assert.deepEqual(carrierGaps(c[0], carriersById, insertsById), [{ start: 0, end: 50 }, { start: 80, end: 240 }]);
    assert.equal(canPlaceInsert(c[0], carriersById, insertsById, 0, 50), true);
    assert.equal(canPlaceInsert(c[0], carriersById, insertsById, 30, 30), false);
    assert.equal(firstFreeInsertPos(c[0], carriersById, insertsById, 60), 80);
    assert.equal(firstFreeInsertPos(c[0], carriersById, insertsById, 200), null);
  });

  test('добавление: на первое свободное, на занятое — отказ, не помещается, несовместимая', () => {
    let c = addInsert(empty(), 0, 'n14', carriersById, insertsById);
    c = addInsert(c, 0, 'n6', carriersById, insertsById);
    assert.deepEqual(c[0].inserts.map((x) => [x.insertId, x.pos]), [['n14', 0], ['n6', 60]]);
    fails(() => addInsert(c, 0, 'n6', carriersById, insertsById, { pos: 70 }), 'occupied');
    fails(() => addInsert(c, 0, 'npe', carriersById, insertsById), 'too-wide');
    fails(() => addInsert(empty('c100'), 0, 'pe14', carriersById, insertsById), 'not-compatible');
    fails(() => addInsert(c, 0, 'nope', carriersById, insertsById), 'unknown-insert');
    fails(() => addInsert(c, 3, 'n6', carriersById, insertsById), 'bad-carrier');
  });

  test('перенос, отказ на занятое, удаление; исходные данные не меняются', () => {
    const c = addInsert(addInsert(empty(), 0, 'n6', carriersById, insertsById), 0, 'n14', carriersById, insertsById);
    const moved = moveInsert(c, 0, 0, 150, carriersById, insertsById);
    assert.deepEqual(moved[0].inserts.map((x) => [x.insertId, x.pos]), [['n14', 30], ['n6', 150]]);
    assert.deepEqual(c[0].inserts.map((x) => x.pos), [0, 30], 'исходный не меняется');
    fails(() => moveInsert(c, 0, 0, 40, carriersById, insertsById), 'occupied');
    assert.deepEqual(removeInsert(c, 0, 0)[0].inserts.map((x) => x.insertId), ['n14']);
  });

  test('притягивание: к соседу в пределах 5 мм, иначе шаг 0,5 мм, в пределах держателя', () => {
    const c = addInsert(empty(), 0, 'n14', carriersById, insertsById, { pos: 0 });
    assert.equal(snapInsertPos(c[0], carriersById, insertsById, 63, 30), 60, 'вплотную к соседу');
    assert.equal(snapInsertPos(c[0], carriersById, insertsById, 100.3, 30), 100.5);
    assert.equal(snapInsertPos(c[0], carriersById, insertsById, 300, 30), 210, 'не правее края');
    assert.equal(snapInsertPos(c[0], carriersById, insertsById, 10, 300), null, 'длиннее держателя');
  });
});

describe('роли и клеммы', () => {
  test('универсальная клемма — роль по крышке, по умолчанию N; общий N+PE — поровну', () => {
    let c = addInsert(empty(), 0, 'kl', carriersById, insertsById);
    assert.equal(c[0].inserts[0].role, 'N');
    assert.deepEqual(carrierClamps(c, insertsById), { N: 15, PE: 0 });
    c = setInsertRole(c, 0, 0, 'PE');
    assert.deepEqual(carrierClamps(c, insertsById), { N: 0, PE: 15 });
    assert.equal(clampsFor({}, insertsById.get('npe'), 'PE'), 12);
  });

  test('держатель — вверх или вниз, только на разрешённое место', () => {
    assert.equal(setCarrierPosition(empty(), 0, 'bottom', carriersById)[0].position, 'bottom');
    fails(() => setCarrierPosition(empty('c100'), 0, 'bottom', carriersById), 'bad-pos');
  });
});

describe('подбор по числу линий', () => {
  test('самая маленькая подходящая клемма; не хватает — несколько; заводские остаются', () => {
    const start = addInsert(empty(), 0, 'n6', carriersById, insertsById);
    const { carriers, short } = autoFill(start, { N: 10, PE: 10 }, carriersById, insertsById);
    // N: было 6, не хватает 4 — самая маленькая подходящая (n6, 6 клемм); PE: 10 — pe14
    assert.deepEqual(carriers[0].inserts.map((x) => [x.insertId, x.pos]), [['n6', 0], ['n6', 30], ['pe14', 60]]);
    assert.deepEqual(carrierClamps(carriers, insertsById), { N: 12, PE: 14 });
    assert.deepEqual(short, { N: 0, PE: 0 });
  });

  test('места нет — сколько клемм не хватает', () => {
    const { short } = autoFill(empty('c100'), { N: 40, PE: 5 }, carriersById, insertsById);
    assert.ok(short.N > 0);
    assert.equal(short.PE, 5, 'для PE подходящих клемм в коротком держателе нет');
  });

  test('хватает — ничего не добавляется', () => {
    const start = addInsert(empty(), 0, 'npe', carriersById, insertsById);
    const { carriers } = autoFill(start, { N: 10, PE: 10 }, carriersById, insertsById);
    assert.equal(carriers[0].inserts.length, 1);
  });
});

describe('заводская комплектация', () => {
  test('factoryCarriers: из terminalSetup корпуса, место по умолчанию — сверху', () => {
    const enclosure = { terminalSetup: { carriers: [{ carrierId: 'c240', included: true, inserts: [{ insertId: 'n6', pos: 0, included: true }] }] } };
    assert.deepEqual(factoryCarriers(enclosure), [{ carrierId: 'c240', position: 'top', included: true, inserts: [{ insertId: 'n6', pos: 0, included: true }] }]);
    assert.deepEqual(factoryCarriers({}), []);
  });
});

describe('держатели щита', () => {
  test('какие держатели подходят к корпусу и какие клеммы — к держателю', () => {
    const catalog = byId([
      { id: 'a', brand: 'x', enclosureIds: ['box'] },
      { id: 'b', brand: 'x' },
      { id: 'c', brand: 'y' },
      { id: 'd', brand: 'x', enclosureIds: ['other'] },
    ]);
    assert.deepEqual(carrierOptions({ id: 'box', brand: 'x' }, catalog).map((c) => c.id), ['a', 'b']);
    const inserts = byId([...insertsById.values(), { id: 'fix', role: 'N', clamps: [[3, 16]], widthMm: 50, carrierIds: ['c240'], fixed: true }]);
    assert.deepEqual(insertOptions('c100', inserts).map((x) => x.id), ['n6', 'n14', 'kl'], 'без заводских частей и чужих');
  });

  test('добавить, убрать, заменить держатель: место и подходящие клеммы сохраняются', () => {
    let c = addCarrier([], 'c240', carriersById, 'bottom');
    assert.deepEqual(c, [{ carrierId: 'c240', position: 'bottom', included: false, inserts: [] }]);
    assert.equal(addCarrier([], 'c100', carriersById)[0].position, 'top', 'первое разрешённое место');
    fails(() => addCarrier([], 'c100', carriersById, 'bottom'), 'bad-pos');
    fails(() => addCarrier([], 'zzz', carriersById), 'bad-carrier');
    c = addInsert(addInsert(c, 0, 'n14', carriersById, insertsById), 0, 'pe14', carriersById, insertsById);
    const swapped = swapCarrier([{ ...c[0], included: true }], 0, 'c100', carriersById, insertsById);
    // c100 — только сверху и только 100 мм: n14 переходит, pe14 к c100 не подходит
    assert.deepEqual(swapped, [{ carrierId: 'c100', position: 'top', included: false, inserts: [{ insertId: 'n14', pos: 0 }] }]);
    assert.deepEqual(removeCarrier(c, 0), []);
    fails(() => removeCarrier(c, 2), 'bad-carrier');
  });

  test('подбор считает общие шины N+PE для обеих ролей', () => {
    const zoneById = byId([{ id: 'z', lengthMm: 200, positions: ['top'] }]);
    const bars = byId([
      { id: 'pe', role: 'PE', clamps: [[24, 16]], widthMm: 200, carrierIds: ['z'] },
      { id: 'npe', role: 'N+PE', clamps: [[48, 16]], widthMm: 200, carrierIds: ['z'] },
    ]);
    const zones = [{ carrierId: 'z', position: 'top', included: true, inserts: [] }, { carrierId: 'z', position: 'top', included: true, inserts: [] }];
    const { carriers, short } = autoFill(zones, { N: 5, PE: 5 }, zoneById, bars);
    assert.deepEqual(carriers.map((c) => c.inserts.map((x) => x.insertId)), [['npe'], []]);
    assert.deepEqual(short, { N: 0, PE: 0 });
  });

  test('из подходящих клемм — сначала подтверждённые источником', () => {
    const inserts = byId([
      { id: 'cheap', role: 'N', clamps: [[10, 4]], widthMm: 40, verified: false },
      { id: 'sure', role: 'N', clamps: [[11, 16]], widthMm: 80, verified: true },
    ]);
    const { carriers } = autoFill(empty(), { N: 9, PE: 0 }, carriersById, inserts);
    assert.deepEqual(carriers[0].inserts.map((x) => x.insertId), ['sure']);
  });

  test('нужно клемм: по одной на линию (автомат, дифавтомат) и на ввод', () => {
    const devices = byId([{ id: 'm', category: 'mcb' }, { id: 'r', category: 'rcbo' }, { id: 'u', category: 'rcd' }]);
    const board = { rows: [[{ deviceId: 'm' }, { deviceId: 'u' }], [{ deviceId: 'r' }, { deviceId: 'm' }]] };
    assert.deepEqual(clampNeed(board, devices), { N: 4, PE: 4, lines: 3 });
  });
});
