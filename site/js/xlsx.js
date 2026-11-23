// Файл Excel (.xlsx) без сторонних библиотек. Модуль без DOM.
// .xlsx — это zip-архив с XML-частями (Office Open XML). Для одной таблицы
// хватает шести частей; сжатие не нужно, поэтому архив собирается без него (stored).

// ---------- zip ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (как в zip и gzip). */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Дата и время в формате MS-DOS (так их хранит zip); местное время, с точностью до 2 секунд. */
function dosDateTime(date) {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * Zip-архив без сжатия. files: [{ name, data }], data — строка (пишется в UTF-8) или Uint8Array.
 * Имена — только ASCII (здесь это пути частей .xlsx).
 */
export function zip(files, date = new Date()) {
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime(date);
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    if (!/^[\x20-\x7e]+$/.test(file.name)) throw new Error(`zip: имя только ASCII: ${file.name}`);
    const name = encoder.encode(file.name);
    const data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // сигнатура локального заголовка
    local.setUint16(4, 20, true); // версия для распаковки (2.0)
    local.setUint16(6, 0, true); // флаги
    local.setUint16(8, 0, true); // метод: без сжатия
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); // размер сжатый
    local.setUint32(22, data.length, true); // размер исходный
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true); // доп. поле
    parts.push(new Uint8Array(local.buffer), name, data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true); // сигнатура записи каталога
    entry.setUint16(4, 20, true); // создано: версия 2.0
    entry.setUint16(6, 20, true); // нужна версия 2.0
    entry.setUint16(8, 0, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, day, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    // 30: доп. поле, 32: комментарий, 34: номер диска, 36: внутр. атрибуты, 38: внеш. атрибуты — нули
    entry.setUint32(42, offset, true); // где начинается локальный заголовок
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // конец центрального каталога
  end.setUint16(8, files.length, true); // записей на этом диске
  end.setUint16(10, files.length, true); // всего записей
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true); // где начинается каталог
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---------- XML ----------

/** Текст для XML: экранирование и удаление символов, запрещённых в XML 1.0. */
export function xmlText(value) {
  return String(value)
    .replace(/[^\t\n\r\x20-퟿-�\u{10000}-\u{10ffff}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Буква столбца: 0 → A, 25 → Z, 26 → AA. */
export function columnName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Имя листа по правилам Excel: без []:*?/\, не длиннее 31 знака, не пустое. */
export function sheetName(name) {
  const clean = String(name).replace(/[[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31).trim();
  return clean || 'Sheet1';
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const BOLD = 1; // номер стиля ячейки с жирным шрифтом в styles.xml

function cellXml(value, ref, style) {
  const s = style ? ` s="${style}"` : '';
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${s}><v>${value}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
}

/** Ширина столбцов по самому длинному тексту (в знаках), в разумных пределах. */
function columnWidths(head, rows) {
  return head.map((_, i) => {
    const longest = Math.max(...[head, ...rows].map((row) => String(row[i] ?? '').length));
    return Math.min(Math.max(longest + 2, 8), 60);
  });
}

function sheetXml(head, rows) {
  const cols = columnWidths(head, rows)
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('');
  const rowXml = (cells, r, style) =>
    `<row r="${r}">${cells.map((v, i) => cellXml(v, `${columnName(i)}${r}`, style)).join('')}</row>`;
  return (
    XML_HEAD +
    `<worksheet xmlns="${NS_MAIN}">` +
    // Строка заголовков закреплена: при прокрутке длинной спецификации остаётся видна
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${cols}</cols>` +
    `<sheetData>${rowXml(head, 1, BOLD)}${rows.map((row, i) => rowXml(row, i + 2, 0)).join('')}</sheetData>` +
    '</worksheet>'
  );
}

const STYLES_XML =
  XML_HEAD +
  `<styleSheet xmlns="${NS_MAIN}">` +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/**
 * Книга Excel с одним листом: строка заголовков (жирная, закреплена) и строки данных.
 * Числа пишутся числовыми ячейками, строки — как текст, null и '' — пустая ячейка.
 * Возвращает Uint8Array — содержимое файла .xlsx.
 */
export function xlsxWorkbook({ sheet, head, rows }, date = new Date()) {
  const ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
  return zip(
    [
      {
        name: '[Content_Types].xml',
        data:
          XML_HEAD +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          `<Override PartName="/xl/workbook.xml" ContentType="${ct}.sheet.main+xml"/>` +
          `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${ct}.worksheet+xml"/>` +
          `<Override PartName="/xl/styles.xml" ContentType="${ct}.styles+xml"/>` +
          '</Types>',
      },
      {
        name: '_rels/.rels',
        data:
          XML_HEAD +
          `<Relationships xmlns="${NS_PKG_REL}">` +
          `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>` +
          '</Relationships>',
      },
      {
        name: 'xl/workbook.xml',
        data:
          XML_HEAD +
          `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
          `<sheets><sheet name="${xmlText(sheetName(sheet))}" sheetId="1" r:id="rId1"/></sheets>` +
          '</workbook>',
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data:
          XML_HEAD +
          `<Relationships xmlns="${NS_PKG_REL}">` +
          `<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
          `<Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/>` +
          '</Relationships>',
      },
      { name: 'xl/worksheets/sheet1.xml', data: sheetXml(head, rows) },
      { name: 'xl/styles.xml', data: STYLES_XML },
    ],
    date,
  );
}
