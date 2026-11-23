// Выгрузки спецификации: строки таблицы, CSV, имена файлов. Модуль без DOM.
// Excel (.xlsx) собирает xlsx.js из той же таблицы.

import { billOfMaterials } from './board.js';
import { deviceTitle, enclosureTitle, enclosureDescription, num } from './format.js';
import { projectFileName } from './storage.js';

/** Столбцы спецификации (ключи переводов заголовков — `summary.<имя>`). */
export const SPEC_COLUMNS = ['article', 'brand', 'name', 'model', 'modules', 'qty', 'note'];

/** Клеммы текстом: [[2, 25], [11, 16]] → «2×25 + 11×16» (сечения — по правилам языка). */
export function clampsText(clamps, lang) {
  return clamps.map(([count, mm2]) => `${count}×${num(mm2, lang)}`).join(' + ');
}

/** Название держателя клемм N/PE: «Держатель клемм QuickConnect, 240 мм». */
export function carrierName(carrier, t) {
  return t(`carrier.name.${carrier.kind}`, { series: carrier.series ? ` ${carrier.series}` : '', length: num(carrier.lengthMm, t.lang) });
}

/** Название клеммы: «Клемма N, 1×16 + 5×4 мм²»; у универсальной — с ролью по крышке. */
export function insertName(insert, role, t) {
  const clamps = clampsText(insert.clamps, t.lang);
  return insert.role === 'universal' ? t('insert.nameUniversal', { role, clamps }) : t('insert.name', { role: insert.role, clamps });
}

/**
 * Держатели и клеммы N/PE щита в составе: [{ article, brand, name, count, included, verified }].
 * Каждый держатель и каждая клемма — своей строкой, одинаковые суммируются; included — стоит с завода
 * («в комплекте корпуса»), иначе — к заказу. Места под шину (kind: zone) — не деталь, в состав не идут;
 * части заводских колодок без артикула — только как «в комплекте корпуса». Неизвестные пропускаются.
 */
export function carriersSpec(board, carriersById, insertsById, t) {
  const lines = new Map();
  const add = (key, line) => {
    const prev = lines.get(key);
    if (prev) prev.count += 1;
    else lines.set(key, { ...line, count: 1 });
  };
  for (const c of board.carriers ?? []) {
    const carrier = carriersById.get(c.carrierId);
    if (!carrier) continue;
    if (carrier.kind !== 'zone' && (carrier.article || c.included)) {
      add(`c:${carrier.id}:${c.included}`, { article: carrier.article ?? '', brand: carrier.brand, name: carrierName(carrier, t), included: c.included, verified: carrier.verified });
    }
    for (const item of c.inserts) {
      const insert = insertsById.get(item.insertId);
      if (!insert) continue;
      const included = Boolean(item.included);
      if (!insert.article && !included) continue;
      const role = insert.role === 'universal' ? item.role ?? 'N' : insert.role;
      add(`i:${insert.id}:${role}:${included}`, { article: insert.article ?? '', brand: insert.brand, name: insertName(insert, role, t), included, verified: insert.verified });
    }
  }
  return [...lines.values()];
}

/** Гребёнки щита: [{ comb, count }] — по одной на ряд, одинаковые суммируются; неизвестные пропускаются. */
export function combsSpec(board, combsById) {
  const counts = new Map();
  for (const id of board.combs ?? []) {
    if (id && combsById.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts].map(([id, count]) => ({ comb: combsById.get(id), count }));
}

/** Аксессуары гребёнок в составе: [{ part, count }]; неизвестные пропускаются. */
export function combPartsSpec(board, partsById) {
  return Object.entries(board.combParts ?? {})
    .filter(([id]) => partsById.has(id))
    .map(([id, count]) => ({ part: partsById.get(id), count }));
}

/** Название аксессуара гребёнки: «Торцевая заглушка гребёнки» (+ «упаковка 10 шт.»). */
export function combPartName(part, t) {
  const name = t(`combPart.${part.kind}`);
  return part.packQty ? `${name} ${t('combPart.pack', { n: part.packQty })}` : name;
}

/** Название гребёнки: «Гребёнка 1P, вилка, 12 мод.». */
export function combName(comb, t) {
  return t('comb.name', { phases: comb.phases, pin: t(`comb.pin.${comb.pinType}`), length: num(comb.lengthModules, t.lang) });
}

/**
 * Спецификация щита: первой строкой корпус, затем устройства (как в billOfMaterials).
 * Держатели и клеммы N/PE (carriersSpec) — сразу после корпуса; гребёнки и их аксессуары — в конце.
 * Ячейки — строки и числа; `modules` у корпуса — null (пустая ячейка).
 * carrierCatalog — { carriersById, insertsById } (без него держатели в состав не идут).
 * Возвращает { head: [заголовки], rows: [[ячейки по SPEC_COLUMNS]] }.
 */
export function specTable(board, enclosure, devices, brandNames, t, combsById = new Map(), partsById = new Map(), carrierCatalog = null) {
  const note = (item) => (item.verified ? '' : t('device.unverified'));
  const brand = brandNames.get(enclosure.brand) ?? enclosure.brand;
  const enclosureName = t('summary.enclosure', { title: `${enclosureTitle(enclosure)} (${enclosureDescription(enclosure, t)})` });
  const carriers = carrierCatalog ? carriersSpec(board, carrierCatalog.carriersById, carrierCatalog.insertsById, t) : [];
  // «В комплекте корпуса» и «не проверено» — в примечании (чтобы с завода не заказали лишнего и сверили)
  const carrierNote = (line) => [line.included ? t('carrier.specIncluded') : '', note(line)].filter(Boolean).join(', ');
  const rows = [
    [enclosure.article, brand, enclosureName, enclosure.model ?? '', null, 1, note(enclosure)],
    ...carriers.map((line) => [line.article, brandNames.get(line.brand) ?? line.brand, line.name, '', null, line.count, carrierNote(line)]),
    ...billOfMaterials(board).map(({ deviceId, count }) => {
      const d = devices.get(deviceId);
      return [d.article, brandNames.get(d.brand) ?? d.brand, deviceTitle(d, t), d.model ?? '', d.modules, count, note(d)];
    }),
    ...combsSpec(board, combsById).map(({ comb, count }) => [comb.article, brandNames.get(comb.brand) ?? comb.brand, combName(comb, t), comb.model ?? '', null, count, note(comb)]),
    ...combPartsSpec(board, partsById).map(({ part, count }) => [part.article, brandNames.get(part.brand) ?? part.brand, combPartName(part, t), part.model ?? '', null, count, note(part)]),
  ];
  return { head: SPEC_COLUMNS.map((c) => t(`summary.${c}`)), rows };
}

/**
 * Разделитель CSV по языку, как его ждёт Excel с настройками этой страны:
 * там, где десятичная запятая (ru, lt), — точка с запятой; иначе запятая.
 */
export function csvSeparator(lang) {
  return lang === 'en' ? ',' : ';';
}

function csvCell(value, sep, lang) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'number' ? num(value, lang) : String(value);
  // В кавычки — если внутри разделитель, кавычка, перевод строки или пробел по краям
  return text.includes(sep) || /["\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Таблица → текст CSV: строки через CRLF, в начале BOM (иначе Excel
 * показывает кириллицу и литовские буквы как «кракозябры»).
 * Числа — по правилам языка (1,5 для ru/lt, 1.5 для en).
 */
export function toCsv({ head, rows }, lang) {
  const sep = csvSeparator(lang);
  const lines = [head, ...rows].map((row) => row.map((cell) => csvCell(cell, sep, lang)).join(sep));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Имя файла выгрузки: как у файла проекта, но со своим расширением. */
export function exportFileName(enclosure, ext, date = new Date()) {
  return projectFileName(enclosure, date).replace(/\.json$/, `.${ext}`);
}
