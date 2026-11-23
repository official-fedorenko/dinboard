// Выгрузки спецификации: строки таблицы, CSV, имена файлов. Модуль без DOM.
// Excel (.xlsx) собирает xlsx.js из той же таблицы.

import { billOfMaterials } from './board.js';
import { deviceTitle, enclosureTitle, enclosureDescription, num } from './format.js';
import { projectFileName } from './storage.js';

/** Столбцы спецификации (ключи переводов заголовков — `summary.<имя>`). */
export const SPEC_COLUMNS = ['article', 'brand', 'name', 'model', 'modules', 'qty', 'note'];

/**
 * Спецификация щита: первой строкой корпус, затем устройства (как в billOfMaterials).
 * Ячейки — строки и числа; `modules` у корпуса — null (пустая ячейка).
 * Возвращает { head: [заголовки], rows: [[ячейки по SPEC_COLUMNS]] }.
 */
export function specTable(board, enclosure, devices, brandNames, t) {
  const note = (item) => (item.verified ? '' : t('device.unverified'));
  const rows = [
    [
      enclosure.article,
      brandNames.get(enclosure.brand) ?? enclosure.brand,
      t('summary.enclosure', { title: `${enclosureTitle(enclosure)} (${enclosureDescription(enclosure, t)})` }),
      enclosure.model ?? '',
      null,
      1,
      note(enclosure),
    ],
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
