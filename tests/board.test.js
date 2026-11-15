import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  createBoard,
  indexById,
  addDevice,
  removeItem,
  moveItem,
  changeEnclosure,
  boardStats,
  findItem,
  billOfMaterials,
  BoardError,
} from '../site/js/board.js';

const enc = (rows, modulesPerRow = 12, id = `e${rows}x${modulesPerRow}`) => ({ id, rows, modulesPerRow });
const devices = indexById([
  { id: 'mcb', modules: 1 },
  { id: 'rcd2', modules: 2 },
  { id: 'rcd4', modules: 4 },
  { id: 'half', modules: 0.5 },
  { id: 'wide', modules: 12 },
]);

const ids = (board) => board.rows.map((r) => r.map((i) => i.deviceId));
const rejectsWith = (fn, code) =>
  assert.throws(fn, (err) => err instanceof BoardError && err.code === code, `ожидалась ошибка ${code}`);

describe('createBoard', () => {
  test('пустые ряды по числу рядов корпуса', () => {
    const board = createBoard(enc(3));
    assert.deepEqual(board.rows, [[], [], []]);
    assert.equal(board.enclosureId, 'e3x12');
    assert.equal(board.nextUid, 1);
  });
});

describe('addDevice', () => {
  test('добавляет в первый ряд с местом и выдаёт новые uid', () => {
    const e = enc(2);
    let { board, uid } = addDevice(createBoard(e), e, devices, 'mcb');
    assert.equal(uid, 1);
    ({ board, uid } = addDevice(board, e, devices, 'wide'));
    assert.equal(uid, 2);
    assert.deepEqual(ids(board), [['mcb'], ['wide']], 'wide (12) не влез в первый ряд, ушёл во второй');
  });

  test('в указанный ряд и на указанную позицию', () => {
    const e = enc(2);
    let { board } = addDevice(createBoard(e), e, devices, 'mcb', { row: 1 });
    ({ board } = addDevice(board, e, devices, 'rcd2', { row: 1, index: 0 }));
    assert.deepEqual(ids(board), [[], ['rcd2', 'mcb']]);
  });

  test('ряд заполняется ровно до вместимости, дальше — нет места', () => {
    const e = enc(1);
    let board = createBoard(e);
    for (let i = 0; i < 3; i++) ({ board } = addDevice(board, e, devices, 'rcd4'));
    assert.equal(boardStats(board, e, devices).free, 0);
    rejectsWith(() => addDevice(board, e, devices, 'half'), 'no-space');
  });

  test('половинные модули складываются точно', () => {
    const e = enc(1, 1);
    let { board } = addDevice(createBoard(e), e, devices, 'half');
    ({ board } = addDevice(board, e, devices, 'half'));
    assert.equal(boardStats(board, e, devices).free, 0);
  });

  test('ошибки: нет места в указанном ряду, неверный ряд, неизвестное устройство', () => {
    const e = enc(2);
    const { board } = addDevice(createBoard(e), e, devices, 'wide', { row: 0 });
    rejectsWith(() => addDevice(board, e, devices, 'mcb', { row: 0 }), 'no-space');
    rejectsWith(() => addDevice(board, e, devices, 'mcb', { row: 2 }), 'bad-row');
    rejectsWith(() => addDevice(board, e, devices, 'mcb', { row: -1 }), 'bad-row');
    rejectsWith(() => addDevice(board, e, devices, 'nope'), 'unknown-device');
  });

  test('исходный щит не меняется', () => {
    const e = enc(1);
    const before = createBoard(e);
    const snapshot = structuredClone(before);
    addDevice(before, e, devices, 'mcb');
    assert.deepEqual(before, snapshot);
  });
});

describe('removeItem и findItem', () => {
  test('удаляет по uid', () => {
    const e = enc(1);
    let { board } = addDevice(createBoard(e), e, devices, 'mcb');
    let second;
    ({ board, uid: second } = addDevice(board, e, devices, 'rcd2'));
    assert.deepEqual(findItem(board, second), { row: 0, index: 1 });
    board = removeItem(board, 1);
    assert.deepEqual(ids(board), [['rcd2']]);
    assert.equal(findItem(board, 1), null);
    rejectsWith(() => removeItem(board, 1), 'unknown-item');
  });
});

describe('moveItem', () => {
  const setup = () => {
    const e = enc(2);
    let board = createBoard(e);
    for (const id of ['mcb', 'rcd2', 'rcd4']) ({ board } = addDevice(board, e, devices, id, { row: 0 }));
    return { e, board };
  };

  test('перестановка внутри ряда', () => {
    const { e, board } = setup();
    assert.deepEqual(ids(moveItem(board, e, devices, 1, 0, 2)), [['rcd2', 'rcd4', 'mcb'], []]);
    assert.deepEqual(ids(moveItem(board, e, devices, 3, 0, 0)), [['rcd4', 'mcb', 'rcd2'], []]);
  });

  test('в другой ряд, если есть место', () => {
    const { e, board } = setup();
    assert.deepEqual(ids(moveItem(board, e, devices, 2, 1, 0)), [['mcb', 'rcd4'], ['rcd2']]);
  });

  test('в полный ряд — нет места; внутри полного ряда двигать можно', () => {
    const e = enc(2);
    let { board } = addDevice(createBoard(e), e, devices, 'wide', { row: 1 });
    let uid;
    ({ board, uid } = addDevice(board, e, devices, 'mcb', { row: 0 }));
    rejectsWith(() => moveItem(board, e, devices, uid, 1, 0), 'no-space');
    const full = moveItem(board, e, devices, 1, 1, 0);
    assert.deepEqual(ids(full), [['mcb'], ['wide']]);
  });

  test('неизвестный uid и неверный ряд', () => {
    const { e, board } = setup();
    rejectsWith(() => moveItem(board, e, devices, 99, 0, 0), 'unknown-item');
    rejectsWith(() => moveItem(board, e, devices, 1, 5, 0), 'bad-row');
  });
});

describe('changeEnclosure', () => {
  test('в больший корпус всё переносится на свои ряды', () => {
    const small = enc(1);
    let board = createBoard(small);
    for (const id of ['mcb', 'rcd2']) ({ board } = addDevice(board, small, devices, id));
    const big = enc(3);
    const result = changeEnclosure(board, big, devices);
    assert.deepEqual(ids(result.board), [['mcb', 'rcd2'], [], []]);
    assert.equal(result.board.enclosureId, big.id);
    assert.equal(result.board.nextUid, board.nextUid, 'uid не начинаются заново');
    assert.deepEqual(result.overflow, []);
  });

  test('в меньший корпус: лишний ряд переезжает, что не влезло — в overflow', () => {
    const big = enc(2);
    let board = createBoard(big);
    ({ board } = addDevice(board, big, devices, 'rcd4', { row: 0 }));
    ({ board } = addDevice(board, big, devices, 'wide', { row: 1 }));
    ({ board } = addDevice(board, big, devices, 'rcd2', { row: 0 }));
    const small = enc(1);
    const { board: next, overflow } = changeEnclosure(board, small, devices);
    assert.deepEqual(ids(next), [['rcd4', 'rcd2']]);
    assert.deepEqual(overflow.map((i) => i.deviceId), ['wide']);
  });
});

describe('boardStats и billOfMaterials', () => {
  test('сводка и спецификация', () => {
    const e = enc(2);
    let board = createBoard(e);
    for (const id of ['mcb', 'mcb', 'rcd2']) ({ board } = addDevice(board, e, devices, id));
    ({ board } = addDevice(board, e, devices, 'mcb', { row: 1 }));
    const stats = boardStats(board, e, devices);
    assert.deepEqual(stats.rows, [
      { used: 4, free: 8, capacity: 12 },
      { used: 1, free: 11, capacity: 12 },
    ]);
    assert.equal(stats.used, 5);
    assert.equal(stats.free, 19);
    assert.equal(stats.capacity, 24);
    assert.deepEqual(billOfMaterials(board), [
      { deviceId: 'mcb', count: 3 },
      { deviceId: 'rcd2', count: 1 },
    ]);
  });
});
