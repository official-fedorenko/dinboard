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
  setEarthing,
  setAddTerminals,
  rowGaps,
  canPlace,
  firstFreePos,
  nearestFreePos,
  snapPos,
  dropPreview,
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
/** Устройства с местами: 'id@pos'. */
const places = (board) => board.rows.map((r) => r.map((i) => `${i.deviceId}@${i.pos}`));
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
    assert.deepEqual(places(board), [['mcb@0'], ['wide@0']], 'wide (12) не влез в первый ряд, ушёл во второй');
  });

  test('в указанный ряд — на первое свободное место', () => {
    const e = enc(2);
    let { board } = addDevice(createBoard(e), e, devices, 'mcb', { row: 1 });
    ({ board } = addDevice(board, e, devices, 'rcd2', { row: 1 }));
    assert.deepEqual(places(board), [[], ['mcb@0', 'rcd2@1']]);
  });

  test('на указанное место, с пустыми местами между устройствами; в ряду — слева направо', () => {
    const e = enc(1);
    let { board } = addDevice(createBoard(e), e, devices, 'rcd2', { row: 0, pos: 6 });
    ({ board } = addDevice(board, e, devices, 'mcb', { row: 0, pos: 2 }));
    ({ board } = addDevice(board, e, devices, 'half', { row: 0, pos: 11.5 }));
    assert.deepEqual(places(board), [['mcb@2', 'rcd2@6', 'half@11.5']]);
    assert.deepEqual(rowGaps(board, e, devices, 0), [
      { start: 0, end: 2 },
      { start: 3, end: 6 },
      { start: 8, end: 11.5 },
    ]);
    // Без места — в первый свободный промежуток подходящей ширины
    ({ board } = addDevice(board, e, devices, 'rcd2'));
    ({ board } = addDevice(board, e, devices, 'rcd2'));
    assert.deepEqual(places(board), [['rcd2@0', 'mcb@2', 'rcd2@3', 'rcd2@6', 'half@11.5']]);
  });

  test('на занятое место — отказ (occupied); вне рейки или не по шагу 0.5 — bad-pos', () => {
    const e = enc(1);
    const { board } = addDevice(createBoard(e), e, devices, 'rcd4', { row: 0, pos: 4 });
    rejectsWith(() => addDevice(board, e, devices, 'mcb', { row: 0, pos: 5 }), 'occupied');
    rejectsWith(() => addDevice(board, e, devices, 'rcd2', { row: 0, pos: 3 }), 'occupied'); // задевает соседа на модуль
    rejectsWith(() => addDevice(board, e, devices, 'rcd2', { row: 0, pos: 11 }), 'bad-pos');
    rejectsWith(() => addDevice(board, e, devices, 'mcb', { row: 0, pos: -1 }), 'bad-pos');
    rejectsWith(() => addDevice(board, e, devices, 'mcb', { row: 0, pos: 0.3 }), 'bad-pos');
    assert.doesNotThrow(() => addDevice(board, e, devices, 'mcb', { row: 0, pos: 3 }), 'вплотную к соседу можно');
  });

  test('места в сумме хватает, но не подряд — нет места', () => {
    const e = enc(1, 4);
    let { board } = addDevice(createBoard(e), e, devices, 'mcb', { row: 0, pos: 1 });
    ({ board } = addDevice(board, e, devices, 'mcb', { row: 0, pos: 3 }));
    assert.equal(boardStats(board, e, devices).free, 2);
    rejectsWith(() => addDevice(board, e, devices, 'rcd2'), 'no-space');
    rejectsWith(() => addDevice(board, e, devices, 'rcd2', { row: 0 }), 'no-space');
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
    assert.deepEqual(places(board), [['half@0', 'half@0.5']]);
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
  test('удаляет по uid, соседи остаются на местах', () => {
    const e = enc(1);
    let { board } = addDevice(createBoard(e), e, devices, 'mcb');
    let second;
    ({ board, uid: second } = addDevice(board, e, devices, 'rcd2'));
    assert.deepEqual(findItem(board, second), { row: 0, index: 1 });
    board = removeItem(board, 1);
    assert.deepEqual(places(board), [['rcd2@1']]);
    assert.equal(findItem(board, 1), null);
    rejectsWith(() => removeItem(board, 1), 'unknown-item');
  });
});

describe('moveItem', () => {
  // Ряд 1 на 12 модулей: mcb@0 (uid 1), rcd2@1 (uid 2), rcd4@3 (uid 3); ряд 2 пустой
  const setup = () => {
    const e = enc(2);
    let board = createBoard(e);
    for (const id of ['mcb', 'rcd2', 'rcd4']) ({ board } = addDevice(board, e, devices, id, { row: 0 }));
    return { e, board };
  };

  test('в любое свободное место ряда', () => {
    const { e, board } = setup();
    assert.deepEqual(places(moveItem(board, e, devices, 1, 0, 10)), [['rcd2@1', 'rcd4@3', 'mcb@10'], []]);
    assert.deepEqual(places(moveItem(board, e, devices, 3, 0, 7.5)), [['mcb@0', 'rcd2@1', 'rcd4@7.5'], []]);
    assert.deepEqual(places(moveItem(board, e, devices, 3, 0, 4)), [['mcb@0', 'rcd2@1', 'rcd4@4'], []], 'частично на своё же место');
  });

  test('на занятое место — отказ; за край рейки — bad-pos', () => {
    const { e, board } = setup();
    rejectsWith(() => moveItem(board, e, devices, 1, 0, 2), 'occupied');
    rejectsWith(() => moveItem(board, e, devices, 3, 0, 9), 'bad-pos');
  });

  test('в другой ряд, если место свободно', () => {
    const { e, board } = setup();
    assert.deepEqual(places(moveItem(board, e, devices, 2, 1, 5)), [['mcb@0', 'rcd4@3'], ['rcd2@5']]);
    const full = addDevice(board, e, devices, 'wide', { row: 1 }).board;
    rejectsWith(() => moveItem(full, e, devices, 1, 1, 0), 'occupied');
  });

  test('неизвестный uid и неверный ряд', () => {
    const { e, board } = setup();
    rejectsWith(() => moveItem(board, e, devices, 99, 0, 0), 'unknown-item');
    rejectsWith(() => moveItem(board, e, devices, 1, 5, 0), 'bad-row');
  });
});

describe('поиск свободного места', () => {
  // Ряд 1 на 12 модулей: rcd2@2 (uid 1), rcd4@6 (uid 2) — свободно [0,2), [4,6), [10,12)
  const e = enc(2);
  let board = createBoard(e);
  ({ board } = addDevice(board, e, devices, 'rcd2', { row: 0, pos: 2 }));
  ({ board } = addDevice(board, e, devices, 'rcd4', { row: 0, pos: 6 }));

  test('canPlace и firstFreePos', () => {
    assert.equal(canPlace(board, e, devices, 0, 4, 2), true);
    assert.equal(canPlace(board, e, devices, 0, 4, 2.5), false);
    assert.equal(canPlace(board, e, devices, 0, 4, 4, 2), true, 'своё место (rcd4) не мешает');
    assert.equal(firstFreePos(board, e, devices, 0, 2), 0);
    assert.equal(firstFreePos(board, e, devices, 0, 3), null);
    assert.equal(firstFreePos(board, e, devices, 1, 12), 0);
  });

  test('nearestFreePos: на шаг в сторону, вплотную к соседу или нет места', () => {
    // rcd2 с 2: влево — на 1, вправо — на 3
    assert.equal(nearestFreePos(board, e, devices, 0, 2, 1, { ignoreUid: 1, direction: -1, from: 2 }), 1);
    assert.equal(nearestFreePos(board, e, devices, 0, 2, 3, { ignoreUid: 1, direction: 1, from: 2 }), 3);
    // rcd4 с 6: вправо — на 7, влево — на 5
    assert.equal(nearestFreePos(board, e, devices, 0, 4, 7, { ignoreUid: 2, direction: 1, from: 6 }), 7);
    assert.equal(nearestFreePos(board, e, devices, 0, 4, 5, { ignoreUid: 2, direction: -1, from: 6 }), 5);
    // rcd4 вплотную к rcd2 (с 4): левее только 2 свободных модуля — некуда
    assert.equal(nearestFreePos(board, e, devices, 0, 4, 3, { ignoreUid: 2, direction: -1, from: 4 }), null);
    // mcb с 4 влево: сосед rcd2 (2–4) перепрыгивается — ближайшее свободное слева 1
    assert.equal(nearestFreePos(board, e, devices, 0, 1, 3, { direction: -1, from: 4 }), 1);
    // В другой ряд — ближайшее к текущему месту
    assert.equal(nearestFreePos(board, e, devices, 1, 4, 6), 6);
  });

  test('snapPos: к целым модулям и краям соседей; рядом свободное — оно', () => {
    assert.equal(snapPos(board, e, devices, 1, 3.3, 2), 3);
    assert.equal(snapPos(board, e, devices, 1, -2, 2), 0, 'не левее края');
    assert.equal(snapPos(board, e, devices, 1, 20, 2), 10, 'не правее края');
    assert.equal(snapPos(board, e, devices, 0, 3.6, 1), 4, 'вплотную к правому краю rcd2');
    // Место под устройством занято — остаётся оно (перенос получит отказ), а не ближайшее свободное
    assert.equal(snapPos(board, e, devices, 0, 3.06, 1), 3);
    assert.equal(snapPos(board, e, devices, 0, 3.4, 1), 3);
    assert.equal(snapPos(board, e, devices, 0, 7, 1), 7);
    assert.equal(snapPos(board, e, devices, 1, 3, 13), null, 'шире рейки');
    const odd = indexById([...devices.values(), { id: 'x75', modules: 7.5 }]);
    const withOdd = addDevice(createBoard(e), e, odd, 'x75', { row: 0, pos: 0 }).board;
    assert.equal(snapPos(withOdd, e, odd, 0, 7.8, 1), 7.5, 'вплотную к устройству шириной 7.5');
  });

  test('dropPreview: то же место, что snapPos, и свободно ли оно', () => {
    assert.deepEqual(dropPreview(board, e, devices, 1, 3.3, 2), { pos: 3, ok: true });
    assert.deepEqual(dropPreview(board, e, devices, 0, 3.06, 1), { pos: 3, ok: false }, 'занято — красная подсказка');
    assert.deepEqual(dropPreview(board, e, devices, 0, 3.6, 1), { pos: 4, ok: true });
    assert.equal(dropPreview(board, e, devices, 1, 3, 13), null, 'шире рейки — без подсказки');
    // Своё место не считается занятым (uid 1 — rcd2 на модулях 2–4)
    assert.deepEqual(dropPreview(board, e, devices, 0, 2.2, 2, 1), { pos: 2, ok: true });
    assert.deepEqual(dropPreview(board, e, devices, 0, 2.2, 2), { pos: 2, ok: false }, 'чужое устройство на этом месте');
  });
});

describe('changeEnclosure', () => {
  test('в больший корпус всё переносится на свои ряды и места', () => {
    const small = enc(1);
    let board = createBoard(small);
    for (const id of ['mcb', 'rcd2']) ({ board } = addDevice(board, small, devices, id));
    const big = enc(3);
    const result = changeEnclosure(board, big, devices);
    assert.deepEqual(places(result.board), [['mcb@0', 'rcd2@1'], [], []]);
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

  test('места сохраняются; не влезающее в короткую рейку — на свободное место, остальные не сдвигаются', () => {
    const wide = enc(2, 18);
    let board = createBoard(wide);
    ({ board } = addDevice(board, wide, devices, 'rcd4', { row: 0, pos: 14 }));
    ({ board } = addDevice(board, wide, devices, 'mcb', { row: 0, pos: 5 }));
    ({ board } = addDevice(board, wide, devices, 'rcd2', { row: 1, pos: 9 }));
    const { board: next, overflow } = changeEnclosure(board, enc(2, 12), devices);
    assert.deepEqual(places(next), [['rcd4@0', 'mcb@5'], ['rcd2@9']]);
    assert.deepEqual(overflow, []);
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

describe('система заземления', () => {
  test('по умолчанию не указана, задаётся и сохраняется при смене корпуса', () => {
    const e = enc(2);
    const board = createBoard(e);
    assert.equal(board.earthing, null);
    const tt = setEarthing(board, 'TT');
    assert.equal(tt.earthing, 'TT');
    assert.equal(board.earthing, null, 'исходный щит не меняется');
    assert.equal(changeEnclosure(tt, enc(1), devices).board.earthing, 'TT');
    assert.equal(setEarthing(tt, null).earthing, null);
  });
});

describe('клеммники N/PE в составе', () => {
  test('setAddTerminals: флаг только при true, сохраняется при смене корпуса', () => {
    const board = createBoard(enc(2));
    assert.equal('addTerminals' in board, false);
    const on = setAddTerminals(board, true);
    assert.equal(on.addTerminals, true);
    assert.equal('addTerminals' in board, false, 'исходный щит не меняется');
    assert.equal(changeEnclosure(on, enc(1), devices).board.addTerminals, true);
    assert.equal('addTerminals' in changeEnclosure(board, enc(1), devices).board, false);
    assert.equal('addTerminals' in setAddTerminals(on, false), false);
  });
});
