// Модель щита: корпус, ряды DIN-реек и расставленные в них устройства.
// Модуль без DOM. Все функции чистые: возвращают новый объект щита, исходный не меняют.
//
// Щит: { version, enclosureId, rows: [[{ uid, deviceId, pos }, ...], ...], nextUid, earthing }
// earthing — система заземления (TN-S / TN-C-S / TT) или null, если не указана.
// pos — с какого модуля рейки начинается устройство (0 — левый край), шаг 0.5 модуля.
// Устройства можно ставить в любое свободное место: между ними остаются пустые места
// (на схеме — заглушки). Устройства не перекрываются; в массиве ряда они идут слева направо.
// Ширина устройства и вместимость ряда — в модулях (ширина берётся из каталога).

export const BOARD_VERSION = 1;

/** Шаг позиции на рейке, в модулях (есть устройства шириной 0.5 и 7.5 модуля). */
export const POS_STEP = 0.5;

/**
 * Ошибка действия со щитом.
 * code: 'no-space' (нет свободного места нужной ширины) | 'occupied' (место занято другим устройством) |
 * 'bad-pos' (позиция вне рейки или не кратна шагу) | 'unknown-device' | 'unknown-item' | 'bad-row'.
 */
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
    earthing: null,
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

const onStep = (pos) => Number.isFinite(pos) && Number.isInteger(pos / POS_STEP);

/**
 * Свободные промежутки ряда: [{ start, end }] слева направо (в модулях).
 * ignoreUid — устройство, которое не считается (его переносят).
 */
export function rowGaps(board, enclosure, devices, row, ignoreUid = null) {
  const gaps = [];
  let x = 0;
  for (const item of board.rows[row]) {
    if (item.uid === ignoreUid) continue;
    if (item.pos > x) gaps.push({ start: x, end: item.pos });
    x = Math.max(x, item.pos + widthOf(devices, item.deviceId));
  }
  if (enclosure.modulesPerRow > x) gaps.push({ start: x, end: enclosure.modulesPerRow });
  return gaps;
}

/** Встаёт ли устройство шириной width в ряд row с позиции pos (без перекрытий). */
export function canPlace(board, enclosure, devices, row, pos, width, ignoreUid = null) {
  return rowGaps(board, enclosure, devices, row, ignoreUid).some((g) => pos >= g.start && pos + width <= g.end);
}

/** Самое левое свободное место для устройства шириной width или null. */
export function firstFreePos(board, enclosure, devices, row, width, ignoreUid = null) {
  return rowGaps(board, enclosure, devices, row, ignoreUid).find((g) => g.end - g.start >= width)?.start ?? null;
}

/**
 * Ближайшее к target свободное место для устройства шириной width или null.
 * direction: -1 — только левее from, 1 — только правее from, 0 — в любую сторону.
 * Нужна для кнопок ← → ↑ ↓: устройство «перепрыгивает» соседа до ближайшего свободного места.
 */
export function nearestFreePos(board, enclosure, devices, row, width, target, { ignoreUid = null, direction = 0, from = target } = {}) {
  let best = null;
  for (const g of rowGaps(board, enclosure, devices, row, ignoreUid)) {
    let lo = g.start;
    let hi = g.end - width;
    if (direction < 0) hi = Math.min(hi, from - POS_STEP);
    if (direction > 0) lo = Math.max(lo, from + POS_STEP);
    if (hi < lo) continue;
    const pos = Math.min(Math.max(target, lo), hi);
    if (best === null || Math.abs(pos - target) < Math.abs(best - target)) best = pos;
  }
  return best;
}

/**
 * Позиция для перетаскивания: raw — где оказался левый край устройства (в модулях, дробное).
 * Притягивается вплотную к соседу (если до его края не больше половины модуля и место свободно),
 * иначе — к ближайшему целому модулю. Занято ли это место, проверяет перенос (и отказывает).
 * Возвращает позицию или null, если устройство шире рейки.
 */
export function snapPos(board, enclosure, devices, row, raw, width, ignoreUid = null) {
  const max = enclosure.modulesPerRow - width;
  if (max < 0) return null;
  const byDistance = (list) => list.filter((p) => p >= 0 && p <= max).sort((a, b) => Math.abs(a - raw) - Math.abs(b - raw) || a - b);
  const isFree = (p) => canPlace(board, enclosure, devices, row, p, width, ignoreUid);
  // Вплотную к соседу (до половины модуля) — важнее целого модуля: не остаётся щели в 0.5
  const edges = [];
  for (const item of board.rows[row]) {
    if (item.uid === ignoreUid) continue;
    edges.push(item.pos + widthOf(devices, item.deviceId), item.pos - width);
  }
  const edge = byDistance(edges).find((p) => Math.abs(p - raw) <= 0.5 && isFree(p));
  if (edge !== undefined) return edge;
  // Иначе — ближайший целый модуль (или край соседа), даже если он занят: на занятое место — отказ,
  // устройство не «уезжает» само на соседнее свободное место
  const grid = [0, max];
  for (let p = 1; p < max; p++) grid.push(p);
  return byDistance([...grid, ...edges])[0];
}

/**
 * Подсказка при перетаскивании: куда встанет устройство шириной width, если отпустить
 * его в точке raw ряда row, и свободно ли там. { pos, ok } или null (устройство шире рейки).
 * pos — как у snapPos (тот же расчёт, что и при отпускании), ok — место свободно.
 */
export function dropPreview(board, enclosure, devices, row, raw, width, ignoreUid = null) {
  const pos = snapPos(board, enclosure, devices, row, raw, width, ignoreUid);
  if (pos === null) return null;
  return { pos, ok: canPlace(board, enclosure, devices, row, pos, width, ignoreUid) };
}

function checkPos(enclosure, pos, width) {
  if (!onStep(pos) || pos < 0 || pos + width > enclosure.modulesPerRow) throw new BoardError('bad-pos', { pos });
}

/** Ряды с устройством item в ряду row (с сохранением порядка слева направо). */
function withItem(rows, row, item) {
  const next = rows.map((r) => [...r]);
  const at = next[row].findIndex((other) => other.pos > item.pos);
  next[row].splice(at === -1 ? next[row].length : at, 0, item);
  return next;
}

/**
 * Добавляет устройство.
 * { row, pos } — на это место: занято — BoardError('occupied'), вне рейки — 'bad-pos'.
 * Только row — на первое свободное место ряда; без row — в первый ряд, где есть место.
 * Возвращает { board, uid }. Нет места — BoardError('no-space').
 */
export function addDevice(board, enclosure, devices, deviceId, { row, pos } = {}) {
  const width = widthOf(devices, deviceId);
  let target = row;
  let at = pos;
  if (target === undefined) {
    target = board.rows.findIndex((_, i) => firstFreePos(board, enclosure, devices, i, width) !== null);
    if (target === -1) throw new BoardError('no-space', { deviceId });
    at = firstFreePos(board, enclosure, devices, target, width);
  } else {
    checkRow(board, target);
    if (at === undefined) {
      at = firstFreePos(board, enclosure, devices, target, width);
      if (at === null) throw new BoardError('no-space', { deviceId, row: target });
    } else {
      checkPos(enclosure, at, width);
      if (!canPlace(board, enclosure, devices, target, at, width)) throw new BoardError('occupied', { deviceId, row: target });
    }
  }
  const uid = board.nextUid;
  return { board: { ...board, rows: withItem(board.rows, target, { uid, deviceId, pos: at }), nextUid: uid + 1 }, uid };
}

/** Удаляет устройство по uid. Соседи остаются на своих местах. */
export function removeItem(board, uid) {
  const at = findItem(board, uid);
  if (!at) throw new BoardError('unknown-item', { uid });
  const rows = board.rows.map((r) => [...r]);
  rows[at.row].splice(at.index, 1);
  return { ...board, rows };
}

/**
 * Перемещает устройство в ряд toRow на позицию toPos (в модулях).
 * Место занято другим устройством — BoardError('occupied'), вне рейки — 'bad-pos'.
 */
export function moveItem(board, enclosure, devices, uid, toRow, toPos) {
  const at = findItem(board, uid);
  if (!at) throw new BoardError('unknown-item', { uid });
  checkRow(board, toRow);
  const item = board.rows[at.row][at.index];
  const width = widthOf(devices, item.deviceId);
  checkPos(enclosure, toPos, width);
  if (!canPlace(board, enclosure, devices, toRow, toPos, width, uid)) {
    throw new BoardError('occupied', { deviceId: item.deviceId, row: toRow });
  }
  const rows = board.rows.map((r) => [...r]);
  rows[at.row].splice(at.index, 1);
  return { ...board, rows: withItem(rows, toRow, { ...item, pos: toPos }) };
}

/**
 * Переносит устройства в другой корпус. Сначала каждое устройство остаётся на своём месте
 * (тот же ряд и позиция), если ряд есть и рейка достаточно длинная. Остальные — на первое
 * свободное место своего ряда, затем любого ряда.
 * Что не поместилось — в overflow (список { uid, deviceId, pos }), в щит не попадает.
 */
export function changeEnclosure(board, enclosure, devices) {
  let next = { ...createBoard(enclosure), nextUid: board.nextUid, earthing: board.earthing ?? null };
  const overflow = [];
  const rest = [];
  board.rows.forEach((items, rowIndex) => {
    for (const item of items) {
      const width = widthOf(devices, item.deviceId);
      if (rowIndex < next.rows.length && canPlace(next, enclosure, devices, rowIndex, item.pos, width)) {
        next = { ...next, rows: withItem(next.rows, rowIndex, item) };
      } else {
        rest.push({ item, rowIndex, width });
      }
    }
  });
  for (const { item, rowIndex, width } of rest) {
    const order = [rowIndex, ...next.rows.keys()].filter((r) => r < next.rows.length);
    const row = order.find((r) => firstFreePos(next, enclosure, devices, r, width) !== null);
    if (row === undefined) {
      overflow.push(item);
      continue;
    }
    const pos = firstFreePos(next, enclosure, devices, row, width);
    next = { ...next, rows: withItem(next.rows, row, { ...item, pos }) };
  }
  return { board: next, overflow };
}

/** Система заземления щита (null — не указана). */
export function setEarthing(board, earthing) {
  return { ...board, earthing: earthing ?? null };
}

/** Спецификация: [{ deviceId, count }] в порядке первого появления (слева направо, сверху вниз). */
export function billOfMaterials(board) {
  const counts = new Map();
  for (const row of board.rows) {
    for (const { deviceId } of row) counts.set(deviceId, (counts.get(deviceId) ?? 0) + 1);
  }
  return [...counts].map(([deviceId, count]) => ({ deviceId, count }));
}
