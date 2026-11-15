// Модель щита: корпус, ряды DIN-реек и расставленные в них устройства.
// Модуль без DOM. Все функции чистые: возвращают новый объект щита, исходный не меняют.
//
// Щит: { version, enclosureId, rows: [[{ uid, deviceId }, ...], ...], nextUid }
// Устройства в ряду стоят подряд, слева направо, в порядке массива.
// Ширина устройства и вместимость ряда — в модулях (ширина берётся из каталога).

export const BOARD_VERSION = 1;

/** Ошибка действия со щитом. code: 'no-space' | 'unknown-device' | 'unknown-item' | 'bad-row'. */
export class BoardError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'BoardError';
    this.code = code;
    this.details = details;
  }
}

/** Map по id для быстрого поиска устройств и корпусов. */
export function indexById(list) {
  return new Map(list.map((item) => [item.id, item]));
}

/** Пустой щит для корпуса. */
export function createBoard(enclosure) {
  return {
    version: BOARD_VERSION,
    enclosureId: enclosure.id,
    rows: Array.from({ length: enclosure.rows }, () => []),
    nextUid: 1,
  };
}

function widthOf(devices, deviceId) {
  const device = devices.get(deviceId);
  if (!device) throw new BoardError('unknown-device', { deviceId });
  return device.modules;
}

/** Занято модулей в ряду. */
export function rowUsed(board, devices, rowIndex) {
  return board.rows[rowIndex].reduce((sum, item) => sum + widthOf(devices, item.deviceId), 0);
}

/** Сводка по рядам и по щиту целиком. */
export function boardStats(board, enclosure, devices) {
  const capacity = enclosure.modulesPerRow;
  const rows = board.rows.map((_, i) => {
    const used = rowUsed(board, devices, i);
    return { used, free: capacity - used, capacity };
  });
  const used = rows.reduce((s, r) => s + r.used, 0);
  const total = capacity * rows.length;
  return { rows, used, free: total - used, capacity: total };
}

/** Где стоит устройство: { row, index } или null. */
export function findItem(board, uid) {
  for (let row = 0; row < board.rows.length; row++) {
    const index = board.rows[row].findIndex((item) => item.uid === uid);
    if (index !== -1) return { row, index };
  }
  return null;
}

function checkRow(board, row) {
  if (!Number.isInteger(row) || row < 0 || row >= board.rows.length) throw new BoardError('bad-row', { row });
}

function clampIndex(index, length) {
  if (!Number.isInteger(index)) return length;
  return Math.min(Math.max(index, 0), length);
}

function fits(board, enclosure, devices, row, width) {
  return rowUsed(board, devices, row) + width <= enclosure.modulesPerRow;
}

/**
 * Добавляет устройство. Если row не указан — в первый ряд, где хватает места.
 * index — позиция в ряду (по умолчанию в конец).
 * Возвращает { board, uid }. Нет места — BoardError('no-space').
 */
export function addDevice(board, enclosure, devices, deviceId, { row, index } = {}) {
  const width = widthOf(devices, deviceId);
  let target = row;
  if (target === undefined) {
    target = board.rows.findIndex((_, i) => fits(board, enclosure, devices, i, width));
    if (target === -1) throw new BoardError('no-space', { deviceId });
  } else {
    checkRow(board, target);
    if (!fits(board, enclosure, devices, target, width)) throw new BoardError('no-space', { deviceId, row: target });
  }
  const uid = board.nextUid;
  const rows = board.rows.map((r) => [...r]);
  rows[target].splice(clampIndex(index, rows[target].length), 0, { uid, deviceId });
  return { board: { ...board, rows, nextUid: uid + 1 }, uid };
}

/** Удаляет устройство по uid. */
export function removeItem(board, uid) {
  const at = findItem(board, uid);
  if (!at) throw new BoardError('unknown-item', { uid });
  const rows = board.rows.map((r) => [...r]);
  rows[at.row].splice(at.index, 1);
  return { ...board, rows };
}

/**
 * Перемещает устройство в ряд toRow на позицию toIndex (позиция считается
 * после того, как устройство убрано со старого места).
 * В другой ряд — только если там хватает места.
 */
export function moveItem(board, enclosure, devices, uid, toRow, toIndex) {
  const at = findItem(board, uid);
  if (!at) throw new BoardError('unknown-item', { uid });
  checkRow(board, toRow);
  const item = board.rows[at.row][at.index];
  if (toRow !== at.row && !fits(board, enclosure, devices, toRow, widthOf(devices, item.deviceId))) {
    throw new BoardError('no-space', { deviceId: item.deviceId, row: toRow });
  }
  const rows = board.rows.map((r) => [...r]);
  rows[at.row].splice(at.index, 1);
  rows[toRow].splice(clampIndex(toIndex, rows[toRow].length), 0, item);
  return { ...board, rows };
}

/**
 * Переносит устройства в другой корпус. Каждое устройство остаётся в своём ряду,
 * если ряд есть и в нём хватает места; иначе идёт в первый ряд с местом.
 * Что не поместилось — в overflow (список { uid, deviceId }), в щит не попадает.
 */
export function changeEnclosure(board, enclosure, devices) {
  let next = { ...createBoard(enclosure), nextUid: board.nextUid };
  const overflow = [];
  const place = (item, row) => {
    const rows = next.rows.map((r) => [...r]);
    rows[row].push(item);
    next = { ...next, rows };
  };
  board.rows.forEach((items, rowIndex) => {
    for (const item of items) {
      const width = widthOf(devices, item.deviceId);
      if (rowIndex < next.rows.length && fits(next, enclosure, devices, rowIndex, width)) {
        place(item, rowIndex);
        continue;
      }
      const row = next.rows.findIndex((_, i) => fits(next, enclosure, devices, i, width));
      if (row === -1) overflow.push(item);
      else place(item, row);
    }
  });
  return { board: next, overflow };
}

/** Спецификация: [{ deviceId, count }] в порядке первого появления (слева направо, сверху вниз). */
export function billOfMaterials(board) {
  const counts = new Map();
  for (const row of board.rows) {
    for (const { deviceId } of row) counts.set(deviceId, (counts.get(deviceId) ?? 0) + 1);
  }
  return [...counts].map(([deviceId, count]) => ({ deviceId, count }));
}
