// Сохранение и загрузка щита: ссылка, файл проекта, хранилище браузера.
// Модуль без DOM (кроме переданного объекта хранилища): тестируется в Node.
//
// Внутренний вид проекта: { enclosureId, rows: [[deviceId, ...], ...] } — без uid,
// они создаются заново при сборке щита.
//
// Форматы:
//   ссылка — #b=<base64url(JSON)>, JSON: { v: 1, e: enclosureId, d: [уникальные deviceId], r: [[индекс в d, ...], ...] };
//   файл   — JSON: { app: "dinboard", version: 1, savedAt, enclosure: { id, article },
//                    rows: [[{ id, article }, ...], ...] } (артикулы — для человека, при загрузке не нужны);
//   хранилище браузера — тот же формат, что у файла.
// Любые входящие данные проверяются: структура, лимиты, наличие в каталоге, место в рядах.

import { createBoard, addDevice, BoardError } from './board.js';

export const PROJECT_VERSION = 1;
export const STORAGE_KEY = 'dinboard.project.v1';
export const BACKUP_KEY = 'dinboard.project.v1.backup';
export const LINK_PREFIX = '#b=';

export const LIMITS = {
  textLength: 1_000_000, // файл проекта и строка из хранилища
  linkLength: 20_000, // часть ссылки после #b=
  rows: 12,
  itemsPerRow: 72, // 36 модулей по 0.5
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

/** Проект из щита: { enclosureId, rows: [[deviceId]] }. */
export function projectFromBoard(board) {
  return { enclosureId: board.enclosureId, rows: board.rows.map((row) => row.map((item) => item.deviceId)) };
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
  return project;
}

/**
 * Собирает щит из проекта по каталогу.
 * Неизвестный корпус — ProjectError('enclosure'). Устройства, которых нет в каталоге,
 * пропускаются (возвращаются в skipped). Лишние ряды или нехватка места — ProjectError('no-space').
 * Возвращает { board, skipped }.
 */
export function buildBoard(project, enclosures, devices) {
  checkShape(project);
  const enclosure = enclosures.get(project.enclosureId);
  if (!enclosure) throw new ProjectError('enclosure', { enclosureId: project.enclosureId });
  if (project.rows.length > enclosure.rows) throw new ProjectError('no-space', { reason: 'rows' });

  let board = createBoard(enclosure);
  const skipped = [];
  project.rows.forEach((row, rowIndex) => {
    for (const deviceId of row) {
      if (!devices.has(deviceId)) {
        skipped.push(deviceId);
        continue;
      }
      try {
        ({ board } = addDevice(board, enclosure, devices, deviceId, { row: rowIndex }));
      } catch (err) {
        if (err instanceof BoardError && err.code === 'no-space') throw new ProjectError('no-space', { row: rowIndex });
        throw err;
      }
    }
  });
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
  return checkShape({ enclosureId: data.e, rows });
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
    rows: project.rows.map((row) => row.map((id) => ({ id, article: devices.get(id)?.article ?? '' }))),
  };
  return JSON.stringify(data, null, 2) + '\n';
}

/** Проект из текста файла. Ошибка — ProjectError('format'). */
export function projectFromFile(text) {
  const data = parseJson(text, LIMITS.textLength);
  if (!isObject(data) || data.app !== 'dinboard' || data.version !== PROJECT_VERSION) throw formatError('file');
  if (!isObject(data.enclosure) || !Array.isArray(data.rows)) throw formatError('file');
  const rows = data.rows.map((row) => {
    if (!Array.isArray(row)) throw formatError('row');
    return row.map((item) => {
      if (!isObject(item)) throw formatError('item');
      return item.id;
    });
  });
  return checkShape({ enclosureId: data.enclosure.id, rows });
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

  const code = linkCodeFromHash(hash);
  if (code === null) return fromLocal();

  try {
    const fromLink = decodeLink(code);
    const replacesLocal = !localBroken && !isEmptyProject(local) && !sameProject(local, fromLink);
    if (replacesLocal && !confirmLink()) return fromLocal();
    const { board, skipped } = buildBoard(fromLink, enclosures, devices);
    const notices = [];
    if (skipped.length) notices.push({ key: 'project.loadedSkipped', params: { n: skipped.length } });
    if (replacesLocal) notices.push({ key: 'project.linkOpenedBackup' });
    else if (!skipped.length) notices.push({ key: 'project.linkOpened' });
    // Свой щит (или испорченное сохранение) будет перезаписан — откладываем его копию
    return { board, notices, backupText: replacesLocal || localBroken ? localText : null };
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
