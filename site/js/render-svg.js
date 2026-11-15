// Отрисовка щита в SVG: вид спереди со снятой дверцей, в реальных пропорциях.
// Модуль без DOM: раскладка и разметка считаются чистыми функциями (тестируются в Node),
// а результат — строка SVG. Весь текст экранируется.
//
// Единица координат — миллиметр. Размер корпуса берётся из dimensionsMm,
// ширина модуля — 17.5 мм, через лицевую панель видна передняя часть устройств (45 мм).

export const MODULE_MM = 17.5;
export const FACE_MM = 45;
const ROW_PITCH_MM = 125; // шаг рядов у типовых модульных щитов
const CUTOUT_GAP = 3; // зазор выреза панели вокруг устройств
const COVER_INSET = 10; // отступ лицевой панели от края корпуса

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

/** Экранирует текст для вставки в SVG/XML. */
export function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}

const n = (v) => String(Math.round(v * 100) / 100);

/**
 * Кегль подписи (мм): максимум max, но так, чтобы текст вписался в ширину устройства.
 * Средняя ширина знака ≈ 0.6 кегля.
 */
function fitFont(text, width, max) {
  return Math.min(max, (width - 2) / (Math.max(String(text).length, 1) * 0.6));
}

/**
 * Раскладка щита в миллиметрах.
 * Возвращает { width, height, rows: [{ index, x0, x1, y, h, cy, freeX, items: [{ uid, deviceId, x, w }] }] }.
 */
export function layoutBoard(enclosure, board, devices) {
  const { width, height } = enclosure.dimensionsMm;
  const railLength = enclosure.modulesPerRow * MODULE_MM;
  const x0 = (width - railLength) / 2;
  const count = board.rows.length;
  const pitch = Math.min(ROW_PITCH_MM, (height - 2 * COVER_INSET - 20) / count);
  const top = (height - count * pitch) / 2;

  const rows = board.rows.map((items, index) => {
    const cy = top + pitch * (index + 0.5);
    let x = x0;
    const placed = items.map((item) => {
      const w = devices.get(item.deviceId).modules * MODULE_MM;
      const entry = { uid: item.uid, deviceId: item.deviceId, x, w };
      x += w;
      return entry;
    });
    return { index, x0, x1: x0 + railLength, y: cy - FACE_MM / 2, h: FACE_MM, cy, freeX: x, items: placed };
  });
  return { width, height, rows };
}

/**
 * Куда попадает точка (мм) при перетаскивании: ближайший по высоте ряд
 * и позиция в нём — сколько устройств ряда левее точки (по их середине).
 * Точка за пределами корпуса — null: перетаскивание отменяется.
 */
export function hitTest(layout, x, y) {
  if (!layout.rows.length) return null;
  if (!(x >= 0 && y >= 0 && x <= layout.width && y <= layout.height)) return null;
  let best = layout.rows[0];
  for (const row of layout.rows) {
    if (Math.abs(row.cy - y) < Math.abs(best.cy - y)) best = row;
  }
  const index = best.items.filter((item) => item.x + item.w / 2 < x).length;
  return { row: best.index, index };
}

// ---------- устройства ----------

function handle(w, cx) {
  // Рычажок во включённом положении: тёмное основание и светлая верхняя часть
  const hw = Math.max(6.4, w);
  return (
    `<rect class="dev-handle-slot" x="${n(cx - hw / 2)}" y="16" width="${n(hw)}" height="16" rx="1.2"/>` +
    `<rect class="dev-handle" x="${n(cx - hw / 2 + 0.8)}" y="16.8" width="${n(hw - 1.6)}" height="7.6" rx="1"/>`
  );
}

function testButton(x) {
  return `<circle class="dev-test" cx="${n(x)}" cy="24" r="2.6"/><text class="dev-test-text" x="${n(x)}" y="25.3">T</text>`;
}

function deviceFace(device, w) {
  const modules = device.modules;
  const parts = [`<rect class="dev-body" x="0.3" y="0" width="${n(w - 0.6)}" height="${FACE_MM}" rx="1.5"/>`];
  parts.push(`<rect class="dev-stripe" x="0.3" y="0" width="${n(w - 0.6)}" height="3" rx="1"/>`);
  switch (device.category) {
    case 'mcb':
    case 'switch':
      // Многополюсные — общий рычаг на все полюса
      parts.push(handle(modules > 1 ? w - 7 : 6.4, w / 2));
      break;
    case 'rcd':
    case 'rcbo': {
      const leverW = modules > 1 ? Math.max(6.4, w - MODULE_MM - 4) : 6.4;
      const leverCx = modules > 1 ? 2 + leverW / 2 : w / 2;
      parts.push(handle(leverW, leverCx));
      if (modules > 1) parts.push(testButton(w - MODULE_MM / 2));
      break;
    }
    case 'spd': {
      // Окошки индикаторов на каждом модуле
      for (let i = 0; i < Math.round(modules); i++) {
        parts.push(`<rect class="dev-indicator" x="${n(i * MODULE_MM + MODULE_MM / 2 - 3.5)}" y="19" width="7" height="7" rx="1"/>`);
      }
      break;
    }
    default:
      break;
  }
  return parts.join('');
}

/**
 * SVG щита.
 * options: { t, deviceTitle, deviceLabel, title, selectedUid, activeRow, dropRow }
 * deviceTitle/deviceLabel — функции из format.js (передаются, чтобы модуль не зависел от переводов).
 */
export function renderBoardSvg(layout, devices, options) {
  const { t, deviceTitle, deviceLabel, title, selectedUid = null, activeRow = null } = options;
  const { width, height } = layout;
  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" class="board-svg" viewBox="0 0 ${n(width)} ${n(height)}" role="group" aria-label="${escapeXml(title)}">`,
  );
  out.push(`<rect class="enc-body" x="0.5" y="0.5" width="${n(width - 1)}" height="${n(height - 1)}" rx="8"/>`);
  out.push(
    `<rect class="enc-cover" x="${COVER_INSET}" y="${COVER_INSET}" width="${n(width - 2 * COVER_INSET)}" height="${n(height - 2 * COVER_INSET)}" rx="4"/>`,
  );

  for (const row of layout.rows) {
    const active = row.index === activeRow;
    const cutX = row.x0 - CUTOUT_GAP;
    const cutY = row.y - CUTOUT_GAP;
    const cutW = row.x1 - row.x0 + 2 * CUTOUT_GAP;
    // Полоса для маркировки над рядом и номер ряда
    out.push(`<rect class="label-strip" x="${n(row.x0)}" y="${n(cutY - 9)}" width="${n(row.x1 - row.x0)}" height="6" rx="1"/>`);
    out.push(`<text class="row-number" x="${n(cutX - 4)}" y="${n(row.cy + 2.5)}">${row.index + 1}</text>`);
    out.push(
      `<rect class="cutout${active ? ' active' : ''}" data-row="${row.index}" x="${n(cutX)}" y="${n(cutY)}" width="${n(cutW)}" height="${n(FACE_MM + 2 * CUTOUT_GAP)}" rx="1.5"/>`,
    );
    // Заглушка на свободном месте
    if (row.x1 - row.freeX > 0.01) {
      out.push(
        `<rect class="blank" data-row="${row.index}" x="${n(row.freeX + 0.3)}" y="${n(row.y)}" width="${n(row.x1 - row.freeX - 0.6)}" height="${FACE_MM}" rx="1"/>`,
      );
    }
    row.items.forEach((item, index) => {
      const device = devices.get(item.deviceId);
      const label = deviceLabel(device, t);
      const name = deviceTitle(device, t);
      const selected = item.uid === selectedUid;
      const aria = t('item.position', { title: name, row: row.index + 1, place: index + 1 });
      // Подписи крупные (до 8 и 5 мм), чтобы читались и на телефоне
      const mainSize = fitFont(label.main, item.w, 8);
      const subSize = fitFont(label.sub, item.w, 5);
      out.push(
        `<g class="dev cat-${escapeXml(device.category)}${selected ? ' selected' : ''}" transform="translate(${n(item.x)} ${n(row.y)})"` +
          ` data-uid="${item.uid}" data-focus="item-${item.uid}" tabindex="0" role="button" aria-pressed="${selected}" aria-label="${escapeXml(aria)}">` +
          `<title>${escapeXml(`${name} · ${device.article}`)}</title>` +
          deviceFace(device, item.w) +
          `<text class="dev-main" x="${n(item.w / 2)}" y="12" font-size="${n(mainSize)}">${escapeXml(label.main)}</text>` +
          `<text class="dev-sub" x="${n(item.w / 2)}" y="41" font-size="${n(subSize)}">${escapeXml(label.sub)}</text>` +
          (selected ? `<rect class="dev-outline" x="-0.8" y="-0.8" width="${n(item.w + 1.6)}" height="${FACE_MM + 1.6}" rx="2"/>` : '') +
          `</g>`,
      );
    });
  }
  out.push('</svg>');
  return out.join('');
}
