// Сохранение и загрузка щита: ссылка, файл проекта, хранилище браузера.
// Модуль без DOM (кроме переданного объекта хранилища): тестируется в Node.
//
// Внутренний вид проекта: { enclosureId, rows: [[deviceId, ...], ...], positions?: [[pos, ...], ...], earthing?, addTerminals?, combs? } —
// без uid, они создаются заново при сборке щита. positions — с какого модуля начинается каждое
// устройство (по форме как rows). Без positions (старые ссылки и файлы) устройства ставятся подряд.
//
// Форматы:
//   ссылка — #b=<base64url(JSON)>, JSON: { v: 1, e: enclosureId, d: [уникальные deviceId], r: [[индекс в d, ...], ...],
//            p?: [[pos, ...], ...], g?: earthing, t?: 1 (addTerminals), k?: [id гребёнки или null по рядам] };
//   файл   — JSON: { app: "dinboard", version: 1, savedAt, enclosure: { id, article }, earthing?, addTerminals?, combs?,
//                    rows: [[{ id, article, pos? }, ...], ...] } (артикулы — для человека, при загрузке не нужны);
//   хранилище браузера — тот же формат, что у файла.
// Любые входящие данные проверяются: структура, лимиты, наличие в каталоге, место в рядах.

import { createBoard, addDevice, BoardError, POS_STEP } from './board.js';
import { EARTHING_SYSTEMS } from './catalog.js';

export const PROJECT_VERSION = 1;
export const STORAGE_KEY = 'dinboard.project.v1';
export const BACKUP_KEY = 'dinboard.project.v1.backup';
export const LINK_PREFIX = '#b=';

export const LIMITS = {
  textLength: 1_000_000, // файл проекта и строка из хранилища
  linkLength: 20_000, // часть ссылки после #b=
  rows: 12,
  itemsPerRow: 72, // 36 модулей по 0.5
  modulesPerRow: 36, // наибольшая позиция на рейке
  idLength: 100,
};

export const PROJECT_ERROR_CODES = ['format', 'enclosure', 'no-space'];

/** Ошибка проекта. code: 'format' | 'enclosure' | 'no-space'. */
export class ProjectError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'ProjectError';
    this.code = code;
    this.details = details;
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= LIMITS.idLength && /^[a-z0-9-]+$/.test(v);
const formatError = (reason) => new ProjectError('format', { reason });
const isPos = (v) => typeof v === 'number' && Number.isInteger(v / POS_STEP) && v >= 0 && v <= LIMITS.modulesPerRow;

/** Проект из щита: { enclosureId, rows: [[deviceId]], positions: [[pos]], earthing? }. */
export function projectFromBoard(board) {
  const project = {
    enclosureId: board.enclosureId,
    rows: board.rows.map((row) => row.map((item) => item.deviceId)),
    positions: board.rows.map((row) => row.map((item) => item.pos)),
  };
  if (board.earthing) project.earthing = board.earthing;
  if (board.addTerminals) project.addTerminals = true;
  if (board.combs) project.combs = board.combs;
  return project;
}

/** Проверяет общий вид проекта (без каталога). */
function checkShape(project) {
  if (!isObject(project) || !isId(project.enclosureId)) throw formatError('enclosureId');
  if (!Array.isArray(project.rows) || project.rows.length === 0 || project.rows.length > LIMITS.rows) {
    throw formatError('rows');
  }
  for (const row of project.rows) {
    if (!Array.isArray(row) || row.length > LIMITS.itemsPerRow || !row.every(isId)) throw formatError('row');
  }
  if (project.positions !== undefined) {
    const { positions, rows } = project;
    const sameShape = Array.isArray(positions) && positions.length === rows.length;
    if (!sameShape || !positions.every((row, i) => Array.isArray(row) && row.length === rows[i].length && row.every(isPos))) {
      throw formatError('positions');
    }
  }
  if (project.earthing !== undefined && !EARTHING_SYSTEMS.includes(project.earthing)) throw formatError('earthing');
  if (project.addTerminals !== undefined && project.addTerminals !== true) throw formatError('addTerminals');
  // Гребёнки: по одной на ряд (id или null), хотя бы одна задана
  if (project.combs !== undefined) {
    const { combs, rows } = project;
    const ok = Array.isArray(combs) && combs.length === rows.length && combs.every((c) => c === null || isId(c)) && combs.some(Boolean);
    if (!ok) throw formatError('combs');
  }
  return project;
}

/**
 * Собирает щит из проекта по каталогу.
 * Неизвестный корпус — ProjectError('enclosure'). Устройства, которых нет в каталоге,
 * пропускаются (возвращаются в skipped), остальные остаются на своих местах.
 * Сначала устройства встают на свои позиции; если позиции нет или место не подходит
 * (например, в каталоге изменилась ширина устройства) — на первое свободное место своего ряда.
 * Лишние ряды или нехватка места — ProjectError('no-space').
 * Возвращает { board, skipped }.
 */
export function buildBoard(project, enclosures, devices) {
  checkShape(project);
  const enclosure = enclosures.get(project.enclosureId);
  if (!enclosure) throw new ProjectError('enclosure', { enclosureId: project.enclosureId });
  if (project.rows.length > enclosure.rows) throw new ProjectError('no-space', { reason: 'rows' });

  // Гребёнки, которых нет в каталоге, при отрисовке и в составе пропускаются — данные щита их не теряют
  let board = { ...createBoard(enclosure), earthing: project.earthing ?? null, ...(project.addTerminals ? { addTerminals: true } : {}), ...(project.combs ? { combs: [...project.combs] } : {}) };
  const skipped = [];
  const rest = []; // без позиции или место не подошло — после всех, кто встал на своё место
  project.rows.forEach((row, rowIndex) => {
    row.forEach((deviceId, i) => {
      if (!devices.has(deviceId)) {
        skipped.push(deviceId);
        return;
      }
      const pos = project.positions?.[rowIndex][i];
      if (pos === undefined) {
        rest.push({ deviceId, rowIndex });
        return;
      }
      try {
        ({ board } = addDevice(board, enclosure, devices, deviceId, { row: rowIndex, pos }));
      } catch (err) {
        if (!(err instanceof BoardError) || (err.code !== 'occupied' && err.code !== 'bad-pos')) throw err;
        rest.push({ deviceId, rowIndex });
      }
    });
  });
  for (const { deviceId, rowIndex } of rest) {
    try {
      ({ board } = addDevice(board, enclosure, devices, deviceId, { row: rowIndex }));
    } catch (err) {
      if (err instanceof BoardError && err.code === 'no-space') throw new ProjectError('no-space', { row: rowIndex });
      throw err;
    }
  }
  return { board, skipped };
}

// ---------- ссылка ----------

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code) {
  if (!/^[A-Za-z0-9_-]*$/.test(code)) throw formatError('base64');
  const base64 = code.replace(/-/g, '+').replace(/_/g, '/');
  let binary;
  try {
    binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  } catch {
    throw formatError('base64');
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw formatError('utf8');
  }
}

function parseJson(text, maxLength) {
  if (typeof text !== 'string' || text.length > maxLength) throw formatError('size');
  try {
    return JSON.parse(text);
  } catch {
    throw formatError('json');
  }
}

/** Код проекта для ссылки (часть после #b=). */
export function encodeLink(project) {
  checkShape(project);
  const dictionary = [...new Set(project.rows.flat())];
  const index = new Map(dictionary.map((id, i) => [id, i]));
  const compact = { v: PROJECT_VERSION, e: project.enclosureId, d: dictionary, r: project.rows.map((row) => row.map((id) => index.get(id))) };
  if (project.positions) compact.p = project.positions;
  if (project.earthing) compact.g = project.earthing;
  if (project.addTerminals) compact.t = 1;
  if (project.combs) compact.k = project.combs;
  return toBase64Url(JSON.stringify(compact));
}

/** Проект из кода ссылки. Ошибка — ProjectError('format'). */
export function decodeLink(code) {
  if (typeof code !== 'string' || code.length > LIMITS.linkLength) throw formatError('size');
  const data = parseJson(fromBase64Url(code), LIMITS.linkLength);
  if (!isObject(data) || data.v !== PROJECT_VERSION || !Array.isArray(data.d) || !Array.isArray(data.r)) {
    throw formatError('link');
  }
  if (!data.d.every(isId)) throw formatError('dictionary');
  const rows = data.r.map((row) => {
    if (!Array.isArray(row)) throw formatError('row');
    return row.map((i) => {
      if (!Number.isInteger(i) || i < 0 || i >= data.d.length) throw formatError('index');
      return data.d[i];
    });
  });
  return checkShape({
    enclosureId: data.e,
    rows,
    ...(data.p === undefined ? {} : { positions: data.p }),
    ...(data.g === undefined ? {} : { earthing: data.g }),
    ...(data.t === undefined ? {} : { addTerminals: data.t === 1 ? true : data.t }),
    ...(data.k === undefined ? {} : { combs: data.k }),
  });
}

/** Код из адреса страницы (location.hash) или null, если ссылки на щит нет. */
export function linkCodeFromHash(hash) {
  return typeof hash === 'string' && hash.startsWith(LINK_PREFIX) ? hash.slice(LINK_PREFIX.length) : null;
}

// ---------- файл проекта ----------

/** Текст файла проекта. enclosures/devices — Map по id (для артикулов). */
export function projectToFile(project, enclosures, devices, savedAt = new Date()) {
  checkShape(project);
  const data = {
    app: 'dinboard',
    version: PROJECT_VERSION,
    savedAt: savedAt.toISOString(),
    enclosure: { id: project.enclosureId, article: enclosures.get(project.enclosureId)?.article ?? '' },
    ...(project.earthing ? { earthing: project.earthing } : {}),
    ...(project.addTerminals ? { addTerminals: true } : {}),
    ...(project.combs ? { combs: project.combs } : {}),
    rows: project.rows.map((row, r) =>
      row.map((id, i) => ({ id, article: devices.get(id)?.article ?? '', ...(project.positions ? { pos: project.positions[r][i] } : {}) })),
    ),
  };
  return JSON.stringify(data, null, 2) + '\n';
}

/** Проект из текста файла. Ошибка — ProjectError('format'). */
export function projectFromFile(text) {
  const data = parseJson(text, LIMITS.textLength);
  if (!isObject(data) || data.app !== 'dinboard' || data.version !== PROJECT_VERSION) throw formatError('file');
  if (!isObject(data.enclosure) || !Array.isArray(data.rows)) throw formatError('file');
  for (const row of data.rows) {
    if (!Array.isArray(row)) throw formatError('row');
    if (!row.every(isObject)) throw formatError('item');
  }
  // Позиции — у всех устройств или ни у одного (файлы до свободной расстановки — без позиций)
  const items = data.rows.flat();
  const withPos = items.filter((item) => item.pos !== undefined).length;
  if (withPos !== 0 && withPos !== items.length) throw formatError('positions');
  return checkShape({
    enclosureId: data.enclosure.id,
    rows: data.rows.map((row) => row.map((item) => item.id)),
    ...(withPos ? { positions: data.rows.map((row) => row.map((item) => item.pos)) } : {}),
    ...(data.earthing === undefined ? {} : { earthing: data.earthing }),
    ...(data.addTerminals === undefined ? {} : { addTerminals: data.addTerminals }),
    ...(data.combs === undefined ? {} : { combs: data.combs }),
  });
}

/** Имя файла: dinboard-<артикул корпуса>-<дата>.json (только безопасные символы). */
export function projectFileName(enclosure, date = new Date()) {
  const article = String(enclosure?.article ?? 'board').toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40) || 'board';
  return `dinboard-${article}-${date.toISOString().slice(0, 10)}.json`;
}

// ---------- хранилище браузера ----------

/**
 * Обёртка над localStorage: любые ошибки (приватный режим, запрет, переполнение)
 * не ломают конструктор.
 * loadText() → текст сохранения или null; save(project) и saveBackup(text) → true/false.
 */
export function createLocalStore(storage, enclosures, devices) {
  const write = (key, text) => {
    try {
      storage.setItem(key, text);
      return true;
    } catch {
      return false;
    }
  };
  const read = (key) => {
    try {
      const text = storage?.getItem(key);
      return typeof text === 'string' && text !== '' ? text : null;
    } catch {
      return null;
    }
  };
  return {
    loadText() {
      return read(STORAGE_KEY);
    },
    /** Резервная копия, если есть (остаётся и после перезагрузок, пока её не удалят). */
    loadBackup() {
      return read(BACKUP_KEY);
    },
    clearBackup() {
      try {
        storage.removeItem(BACKUP_KEY);
        return true;
      } catch {
        return false;
      }
    },
    save(project) {
      return write(STORAGE_KEY, projectToFile(project, enclosures, devices));
    },
    /** Прежняя версия сохранения — перед тем как её перезапишет урезанный или чужой щит. */
    saveBackup(text) {
      return write(BACKUP_KEY, text);
    },
  };
}

/**
 * Что открыть при загрузке страницы. Чистая функция (без DOM и хранилища).
 * hash — location.hash; localText — текст сохранения из браузера (или null);
 * confirmLink() — спросить, заменить ли сохранённый щит щитом из ссылки.
 * Возвращает { board, notices: [{ key, params }], backupText }:
 *   board — щит или null (пустой старт);
 *   notices — сообщения для пользователя (ключи переводов);
 *   backupText — исходный текст сохранения, который нужно отложить в резервную копию
 *   до первой перезаписи (если сохранение урезано, не подходит или заменяется ссылкой).
 */
export function restoreProject({ hash, localText, enclosures, devices, confirmLink }) {
  let local = null;
  let localBroken = false;
  if (localText) {
    try {
      local = projectFromFile(localText);
    } catch (err) {
      if (!(err instanceof ProjectError)) throw err;
      localBroken = true;
    }
  }

  const fromLocal = () => {
    if (localBroken) return { board: null, notices: [{ key: 'project.localLost' }], backupText: localText };
    if (!local) return { board: null, notices: [], backupText: null };
    try {
      const { board, skipped } = buildBoard(local, enclosures, devices);
      if (skipped.length) {
        return { board, notices: [{ key: 'project.localSkipped', params: { n: skipped.length } }], backupText: localText };
      }
      return { board, notices: [], backupText: null };
    } catch (err) {
      if (!(err instanceof ProjectError)) throw err;
      return { board: null, notices: [{ key: 'project.localLost' }], backupText: localText };
    }
  };

  /**
   * Проект с позициями, как его соберёт buildBoard. Не собирается или собирается с пропусками
   * (устройств нет в каталоге) — как есть: пропущенные устройства участвуют в сравнении,
   * чтобы ссылка не заменила такой щит без вопроса.
   */
  const asPlaced = (project) => {
    try {
      const { board, skipped } = buildBoard(project, enclosures, devices);
      return skipped.length ? project : projectFromBoard(board);
    } catch (err) {
      if (!(err instanceof ProjectError)) throw err;
      return project;
    }
  };
  /** Своё сохранение при сборке теряет устройства (их нет в каталоге) — его нужно отложить в копию. */
  const localTrimmed = () => {
    try {
      return buildBoard(local, enclosures, devices).skipped.length > 0;
    } catch (err) {
      if (!(err instanceof ProjectError)) throw err;
      return true;
    }
  };

  const code = linkCodeFromHash(hash);
  if (code === null) return fromLocal();

  try {
    const fromLink = decodeLink(code);
    // Сравниваем щиты так, как их расставит каталог: старая ссылка без позиций (устройства подряд)
    // на тот же щит, что сохранён, — не замена
    const replacesLocal = !localBroken && !isEmptyProject(local) && !sameProject(asPlaced(local), asPlaced(fromLink));
    if (replacesLocal && !confirmLink()) return fromLocal();
    const { board, skipped } = buildBoard(fromLink, enclosures, devices);
    // Свой щит заменяется или в нём есть устройства не из каталога — при перезаписи они пропадут
    const keepLocal = replacesLocal || (!localBroken && !isEmptyProject(local) && localTrimmed());
    const notices = [];
    if (skipped.length) notices.push({ key: 'project.loadedSkipped', params: { n: skipped.length } });
    if (keepLocal) notices.push({ key: 'project.linkOpenedBackup' });
    else if (!skipped.length) notices.push({ key: 'project.linkOpened' });
    // Свой щит (или испорченное сохранение) будет перезаписан — откладываем его копию
    return { board, notices, backupText: keepLocal || localBroken ? localText : null };
  } catch (err) {
    if (!(err instanceof ProjectError)) throw err;
    const result = fromLocal();
    return { ...result, notices: [{ key: `project.error.${err.code}` }, ...result.notices] };
  }
}

/** Есть ли в проекте устройства. */
export function isEmptyProject(project) {
  return !project || project.rows.every((row) => row.length === 0);
}

/** Одинаковы ли два проекта (корпус и расстановка). */
export function sameProject(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
