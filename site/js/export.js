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

/**
 * Клеммники N/PE в составе щита: { suffix, accessories: [{ article, name, verified }] }.
 * suffix — пометка к строке корпуса («клеммники N/PE в комплекте») или '';
 * accessories — клеммники производителя, если в комплекте их нет и они добавлены (board.addTerminals).
 */
export function terminalsSpec(board, enclosure, t) {
  const terminals = enclosure.terminals;
  if (!terminals) return { suffix: '', accessories: [] };
  // Не подтверждено официальным источником — видно и в составе, и в выгрузках (чтобы клеммники не забыли сверить)
  if (terminals.included) {
    const suffix = t('terminals.specIncluded');
    return { suffix: terminals.verified ? suffix : `${suffix} (${t('device.unverified')})`, accessories: [] };
  }
  if (!board.addTerminals || !terminals.accessories) return { suffix: '', accessories: [] };
  return {
    suffix: '',
    accessories: terminals.accessories.map((a) => ({
      article: a.article,
      verified: a.verified,
      name: a.clamps
        ? t('terminals.accessoryName', { role: a.role, clamps: clampsText(a.clamps, t.lang) })
        : t('terminals.accessoryNameShort', { role: a.role }),
    })),
  };
}

/**
 * Спецификация щита: первой строкой корпус, затем устройства (как в billOfMaterials).
 * Клеммники N/PE: пометка в строке корпуса или клеммники-аксессуары сразу после него.
 * Ячейки — строки и числа; `modules` у корпуса — null (пустая ячейка).
 * Возвращает { head: [заголовки], rows: [[ячейки по SPEC_COLUMNS]] }.
 */
export function specTable(board, enclosure, devices, brandNames, t) {
  const note = (item) => (item.verified ? '' : t('device.unverified'));
  const brand = brandNames.get(enclosure.brand) ?? enclosure.brand;
  const terminals = terminalsSpec(board, enclosure, t);
  const enclosureName = t('summary.enclosure', { title: `${enclosureTitle(enclosure)} (${enclosureDescription(enclosure, t)})` });
  const rows = [
    [enclosure.article, brand, terminals.suffix ? `${enclosureName}, ${terminals.suffix}` : enclosureName, enclosure.model ?? '', null, 1, note(enclosure)],
    ...terminals.accessories.map((a) => [a.article, brand, a.name, '', null, 1, note(a)]),
    ...billOfMaterials(board).map(({ deviceId, count }) => {
      const d = devices.get(deviceId);
      return [d.article, brandNames.get(d.brand) ?? d.brand, deviceTitle(d, t), d.model ?? '', d.modules, count, note(d)];
    }),
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
