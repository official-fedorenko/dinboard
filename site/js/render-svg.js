// Отрисовка щита в SVG: вид спереди со снятой дверцей, в реальных пропорциях.
// Модуль без DOM: раскладка и разметка считаются чистыми функциями (тестируются в Node),
// а результат — строка SVG. Весь текст экранируется.
//
// Единица координат — миллиметр. Размер корпуса берётся из dimensionsMm,
// ширина модуля — 17.5 мм, через лицевую панель видна передняя часть устройств (45 мм).

import { COMB_DEVICE_CATEGORIES } from './catalog.js';
import { carrierPitch } from './carriers.js';

export const MODULE_MM = 17.5;
export const FACE_MM = 45;
const ROW_PITCH_MM = 125; // шаг рядов у типовых модульных щитов
const CUTOUT_GAP = 3; // зазор выреза панели вокруг устройств
// Полоса маркировки над рядом (на ней номера модулей): высота и отступ от выреза.
// Номера кеглем 7.5 мм, как подписи на устройствах: мельче на телефоне не читаются.
const STRIP_MM = 10;
const STRIP_GAP = 3;
// Клеммник N/PE на рисунке: высота (толщина) планки и зазор до рядов
const BAR_GAP = 4;
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
 * Раскладка щита в миллиметрах. Устройство стоит с модуля pos (свободная расстановка),
 * пустые места между устройствами и у краёв — gaps (на схеме их закрывают заглушки).
 * Возвращает { width, height, rows: [{ index, x0, x1, y, h, cy, gaps: [{ x, w }], items: [{ uid, deviceId, pos, x, w }] }] }.
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
    const x1 = x0 + railLength;
    const placed = items.map((item) => ({
      uid: item.uid,
      deviceId: item.deviceId,
      pos: item.pos,
      x: x0 + item.pos * MODULE_MM,
      w: devices.get(item.deviceId).modules * MODULE_MM,
    }));
    const gaps = [];
    let x = x0;
    for (const item of placed) {
      if (item.x - x > 0.01) gaps.push({ x, w: item.x - x });
      x = Math.max(x, item.x + item.w);
    }
    if (x1 - x > 0.01) gaps.push({ x, w: x1 - x });
    return { index, x0, x1, y: cy - FACE_MM / 2, h: FACE_MM, cy, gaps, items: placed };
  });
  return { width, height, rows };
}

/**
 * Куда попадает точка (мм) при перетаскивании: ближайший по высоте ряд
 * и offset — расстояние от левого края рейки в модулях (дробное; может быть вне рейки).
 * Точка за пределами корпуса — null: перетаскивание отменяется.
 */
export function hitTest(layout, x, y) {
  if (!layout.rows.length) return null;
  if (!(x >= 0 && y >= 0 && x <= layout.width && y <= layout.height)) return null;
  let best = layout.rows[0];
  for (const row of layout.rows) {
    if (Math.abs(row.cy - y) < Math.abs(best.cy - y)) best = row;
  }
  return { row: best.index, offset: (x - best.x0) / MODULE_MM };
}

/**
 * Прямоугольник места на рейке (мм) для подсказки при перетаскивании:
 * ряд row, с модуля pos, ширина width модулей. { x, y, w, h } или null, если ряда нет.
 */
export function slotRect(layout, row, pos, width) {
  const r = layout.rows[row];
  if (!r) return null;
  return { x: r.x0 + pos * MODULE_MM, y: r.y, w: width * MODULE_MM, h: FACE_MM };
}

/**
 * Разметка модулей ряда: номера 1…N на полосе маркировки над рядом и деления
 * между модулями на свободных местах (заглушках) — видно, сколько модулей свободно и где.
 */
function moduleGrid(row) {
  const count = Math.round((row.x1 - row.x0) / MODULE_MM);
  const stripY = row.y - CUTOUT_GAP - STRIP_GAP - STRIP_MM;
  const parts = [];
  for (let i = 0; i < count; i++) {
    const cx = row.x0 + (i + 0.5) * MODULE_MM;
    parts.push(`<text class="module-number" x="${n(cx)}" y="${n(stripY + 7.7)}">${i + 1}</text>`);
    if (i > 0) {
      const x = row.x0 + i * MODULE_MM;
      parts.push(`<line class="module-tick" x1="${n(x)}" y1="${n(stripY)}" x2="${n(x)}" y2="${n(stripY + STRIP_MM)}"/>`);
    }
  }
  for (const gap of row.gaps) {
    for (let i = 1; i < count; i++) {
      const x = row.x0 + i * MODULE_MM;
      if (x > gap.x + 0.01 && x < gap.x + gap.w - 0.01) {
        parts.push(`<line class="module-divider" x1="${n(x)}" y1="${n(row.y + 3)}" x2="${n(x)}" y2="${n(row.y + FACE_MM - 3)}"/>`);
      }
    }
  }
  return `<g class="module-grid" aria-hidden="true">${parts.join('')}</g>`;
}

// ---------- держатели клемм N/PE ----------

/** Высота держателя на рисунке и зазор между держателями на одном месте, мм. */
export const CARRIER_MM = 14;
const CARRIER_STACK_GAP = 3;
/**
 * Держатель — у края основания, как в настоящем щите: от наружного края корпуса до держателя, мм
 * (Hager volta: блок клемм ≈ 32 мм от верхнего края — разрез в каталоге Hager PL 2023, с. 92).
 */
export const CARRIER_EDGE_MM = 32;
const INSERT_INSET = 1.2; // клемма чуть ниже держателя: видно, что она вставлена

const clampTotal = (clamps) => (clamps ?? []).reduce((sum, [count]) => sum + count, 0);

/**
 * Держатели клемм N/PE на рисунке: на своём месте — у верхнего или нижнего края основания (CARRIER_EDGE_MM),
 * в настоящую длину, по центру корпуса; несколько на одном месте — друг за другом от края к рядам.
 * Если у края не хватает места до полосы маркировки (низкий корпус), держатели сдвигаются к краю.
 * Возвращает [{ index, carrier, position, included, x, y, w, h, inserts }],
 * inserts — [{ item, insert, role, x, w, clamps, included }] (role — у универсальной клеммы по крышке).
 * Держатели, которых нет в каталоге, пропускаются. Без держателей и при emptySlot — место пунктиром
 * ({ slot: true, x, y, w, h }) у верхнего края.
 */
export function carrierBars(board, layout, carriersById, insertsById, { emptySlot = false } = {}) {
  if (!layout.rows.length) return [];
  const first = layout.rows[0];
  const last = layout.rows[layout.rows.length - 1];
  const step = CARRIER_MM + CARRIER_STACK_GAP;
  // Ниже (выше) этих границ держатель заходил бы на полосу маркировки первого ряда (на последний ряд)
  const topLimit = first.y - CUTOUT_GAP - STRIP_GAP - STRIP_MM - BAR_GAP - CARRIER_MM;
  const bottomLimit = last.y + FACE_MM + CUTOUT_GAP + BAR_GAP;
  const topStart = (count) => Math.max(COVER_INSET, Math.min(CARRIER_EDGE_MM, topLimit - (count - 1) * step));
  const bottomStart = (count) => Math.min(layout.height - COVER_INSET - CARRIER_MM, Math.max(layout.height - CARRIER_EDGE_MM - CARRIER_MM, bottomLimit + (count - 1) * step));
  const placeX = (w) => Math.max(COVER_INSET, (layout.width - w) / 2);
  const list = board.carriers ?? [];
  if (!list.length) {
    if (!emptySlot) return [];
    const w = first.x1 - first.x0;
    return [{ slot: true, x: first.x0, y: topStart(1), w, h: CARRIER_MM }];
  }
  const known = list.filter((c) => carriersById.has(c.carrierId));
  const count = { top: known.filter((c) => c.position !== 'bottom').length, bottom: known.filter((c) => c.position === 'bottom').length };
  const start = { top: topStart(count.top), bottom: bottomStart(count.bottom) };
  const stack = { top: 0, bottom: 0 };
  const out = [];
  list.forEach((c, index) => {
    const carrier = carriersById.get(c.carrierId);
    if (!carrier) return;
    const where = c.position === 'bottom' ? 'bottom' : 'top';
    const level = stack[where]++;
    const y = where === 'bottom' ? start.bottom - level * step : start.top + level * step;
    const x = placeX(carrier.lengthMm);
    const inserts = [];
    c.inserts.forEach((it, item) => {
      const insert = insertsById.get(it.insertId);
      if (!insert) return;
      const role = insert.role === 'universal' ? it.role ?? 'N' : insert.role;
      inserts.push({ item, insert, role, x: x + it.pos, w: insert.widthMm, clamps: clampTotal(insert.clamps), included: Boolean(it.included) });
    });
    out.push({ index, carrier, position: c.position, included: c.included, x, y, w: carrier.lengthMm, h: CARRIER_MM, inserts });
  });
  return out;
}

const INSERT_CLASS = { N: 'n', PE: 'pe', 'N+PE': 'npe', L: 'l' };

/** Клеммы кружками вдоль клеммы (если помещаются). */
function clampDots(x, y, w, h, count, skip) {
  const length = w - skip - 1.5;
  const step = count ? length / count : 0;
  if (step < 1.4) return '';
  const r = Math.min(2, step / 2.6);
  const parts = [];
  for (let i = 0; i < count; i++) {
    parts.push(`<circle class="clamp" cx="${n(x + skip + step * (i + 0.5))}" cy="${n(y + h / 2)}" r="${n(r)}"/>`);
  }
  return parts.join('');
}

/**
 * Держатель с клеммами. Клеммы — кнопки (data-carrier, data-insert): их можно перетаскивать
 * внутри держателя, выделять и убирать с клавиатуры. selected — { carrier, item } выделенной клеммы.
 */
function carrierBar(bar, t, selected, formatNumber) {
  if (bar.slot) {
    return (
      `<g class="carrier kind-slot"><title>${escapeXml(t('carrier.slotTitle'))}</title>` +
      `<rect class="carrier-body" x="${n(bar.x)}" y="${n(bar.y)}" width="${n(bar.w)}" height="${n(bar.h)}" rx="1.5"/>` +
      `<text class="carrier-label" x="${n(bar.x + 2.5)}" y="${n(bar.y + bar.h / 2 + 1.8)}">${escapeXml(t('carrier.slot'))}</text></g>`
    );
  }
  const name = bar.carrier.article ?? t(`carrier.kind.${bar.carrier.kind}`);
  const parts = [
    `<g class="carrier kind-${escapeXml(bar.carrier.kind)}${bar.carrier.color ? ` color-${escapeXml(bar.carrier.color)}` : ''}" data-carrier-index="${bar.index}">`,
    `<rect class="carrier-body" x="${n(bar.x)}" y="${n(bar.y)}" width="${n(bar.w)}" height="${n(bar.h)}" rx="1.5"><title>${escapeXml(`${t('carrier.title', { name, length: formatNumber(bar.w) })}`)}</title></rect>`,
  ];
  // Деления модуля держателя (шаг клеммы, как модули рейки у автоматов) — у держателей, в которые ставят клеммы
  if (bar.carrier.kind === 'carrier') {
    const pitch = carrierPitch(bar.carrier);
    for (let k = 1; k * pitch < bar.w - 0.5; k++) {
      const x = n(bar.x + k * pitch);
      parts.push(`<path class="carrier-tick" d="M${x} ${n(bar.y)}v2.5M${x} ${n(bar.y + bar.h)}v-2.5"/>`);
    }
  }
  if (!bar.inserts.length) {
    parts.push(`<text class="carrier-label" x="${n(bar.x + 2.5)}" y="${n(bar.y + bar.h / 2 + 1.8)}">${escapeXml(bar.carrier.kind === 'zone' ? t('carrier.zoneEmpty') : t('carrier.empty'))}</text>`);
  }
  for (const ins of bar.inserts) {
    const cls = `insert role-${INSERT_CLASS[ins.role] ?? 'l'}${ins.insert.fixed ? ' fixed' : ''}${selected?.carrier === bar.index && selected?.item === ins.item ? ' selected' : ''}`;
    const y = bar.y + INSERT_INSET;
    const h = bar.h - 2 * INSERT_INSET;
    const label = t('insert.title', { role: ins.role, n: ins.clamps });
    const title = ins.insert.article ? `${label} · ${ins.insert.article}` : label;
    parts.push(
      `<g class="${cls}" data-carrier="${bar.index}" data-insert="${ins.item}" data-focus="insert-${bar.index}-${ins.item}" tabindex="0" role="button"` +
        ` aria-pressed="${cls.includes(' selected')}" aria-label="${escapeXml(title)}"><title>${escapeXml(title)}</title>`,
    );
    if (ins.role === 'N+PE') {
      parts.push(`<rect class="ins-n" x="${n(ins.x + 0.2)}" y="${n(y)}" width="${n(ins.w / 2 - 0.2)}" height="${n(h)}" rx="0.8"/>`);
      parts.push(`<rect class="ins-pe" x="${n(ins.x + ins.w / 2)}" y="${n(y)}" width="${n(ins.w / 2 - 0.2)}" height="${n(h)}" rx="0.8"/>`);
    } else {
      parts.push(`<rect class="ins-body" x="${n(ins.x + 0.2)}" y="${n(y)}" width="${n(ins.w - 0.4)}" height="${n(h)}" rx="0.8"/>`);
    }
    const text = ins.role;
    const skip = text.length * 3 + 3;
    parts.push(`<text class="insert-label" x="${n(ins.x + 1.6)}" y="${n(y + h / 2 + 1.7)}">${escapeXml(text)}</text>`);
    parts.push(clampDots(ins.x, y, ins.w, h, ins.clamps, skip));
    if (cls.includes(' selected')) {
      parts.push(`<rect class="insert-outline" x="${n(ins.x - 0.6)}" y="${n(y - 0.6)}" width="${n(ins.w + 1.2)}" height="${n(h + 1.2)}" rx="1.2"/>`);
    }
    parts.push('</g>');
  }
  parts.push('</g>');
  return parts.join('');
}

// Клеммники на DIN-рейку (категория terminal): цвет по назначению
const ROLE_CLASS = { N: 'n', PE: 'pe', 'N+PE': 'npe' };

// ---------- гребёнки ----------

/**
 * Гребёнки рядов на рисунке: [{ row, comb, x, w, y, h }] — полоса над аппаратами (в зазоре выреза,
 * чтобы не закрывать подписи) от первого до последнего аппарата ряда, которые соединяет гребёнка
 * (COMB_DEVICE_CATEGORIES). Гребёнки, которых нет
 * в каталоге (combsById), и ряды без таких аппаратов пропускаются.
 */
export function combBars(layout, board, combsById, devices) {
  const out = [];
  (board.combs ?? []).forEach((id, row) => {
    const comb = id ? combsById.get(id) : null;
    const r = layout.rows[row];
    if (!comb || !r) return;
    const items = r.items.filter((item) => COMB_DEVICE_CATEGORIES.has(devices.get(item.deviceId)?.category));
    if (!items.length) return;
    const x = Math.min(...items.map((i) => i.x));
    const x2 = Math.max(...items.map((i) => i.x + i.w));
    out.push({ row, comb, x: x + 1, w: x2 - x - 2, y: r.y - CUTOUT_GAP + 0.4, h: CUTOUT_GAP - 0.6 });
  });
  return out;
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
    case 'terminal': {
      // Клеммник: ряд винтовых клемм (по числу клемм, если оно известно, иначе по две на модуль)
      const count = device.specs.clamps ? device.specs.clamps.reduce((sum, [c]) => sum + c, 0) : Math.max(1, Math.round(modules * 2));
      const step = (w - 2) / count;
      const r = Math.min(2.4, step / 2.4);
      parts.push(`<rect class="dev-terminal-bar" x="1" y="18" width="${n(w - 2)}" height="12" rx="1"/>`);
      for (let i = 0; i < count; i++) parts.push(`<circle class="dev-screw" cx="${n(1 + step * (i + 0.5))}" cy="24" r="${n(r)}"/>`);
      break;
    }
    case 'distribution': {
      // Распределительный блок: латунная шина и винты по модулям
      parts.push(`<rect class="dev-brass" x="2" y="17" width="${n(w - 4)}" height="14" rx="1"/>`);
      for (let i = 0; i < Math.max(1, Math.round(modules)); i++) parts.push(`<circle class="dev-screw" cx="${n(i * MODULE_MM + MODULE_MM / 2)}" cy="24" r="2.4"/>`);
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
 * options: { t, deviceTitle, deviceLabel, title, selectedUid, activeRow, formatNumber, carriers, selectedInsert, combs }
 * carriers — держатели клемм N/PE из carrierBars (необязательно); selectedInsert — { carrier, item } выделенной клеммы;
 * combs — гребёнки из combBars (необязательно).
 * deviceTitle/deviceLabel — функции из format.js (передаются, чтобы модуль не зависел от переводов);
 * formatNumber — число по правилам языка (номер модуля может быть дробным: 7,5).
 */
export function renderBoardSvg(layout, devices, options) {
  const { t, deviceTitle, deviceLabel, title, selectedUid = null, activeRow = null, formatNumber = String, carriers = [], selectedInsert = null, combs = [] } = options;
  const { width, height } = layout;
  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" class="board-svg" viewBox="0 0 ${n(width)} ${n(height)}" role="group" aria-label="${escapeXml(title)}">`,
  );
  out.push(`<rect class="enc-body" x="0.5" y="0.5" width="${n(width - 1)}" height="${n(height - 1)}" rx="8"/>`);
  out.push(
    `<rect class="enc-cover" x="${COVER_INSET}" y="${COVER_INSET}" width="${n(width - 2 * COVER_INSET)}" height="${n(height - 2 * COVER_INSET)}" rx="4"/>`,
  );

  for (const bar of carriers) out.push(carrierBar(bar, t, selectedInsert, formatNumber));

  for (const row of layout.rows) {
    const active = row.index === activeRow;
    const cutX = row.x0 - CUTOUT_GAP;
    const cutY = row.y - CUTOUT_GAP;
    const cutW = row.x1 - row.x0 + 2 * CUTOUT_GAP;
    // Полоса для маркировки над рядом и номер ряда
    out.push(`<rect class="label-strip" x="${n(row.x0)}" y="${n(cutY - STRIP_GAP - STRIP_MM)}" width="${n(row.x1 - row.x0)}" height="${STRIP_MM}" rx="1"/>`);
    out.push(`<text class="row-number" x="${n(cutX - 4)}" y="${n(row.cy + 2.5)}">${row.index + 1}</text>`);
    out.push(
      `<rect class="cutout${active ? ' active' : ''}" data-row="${row.index}" x="${n(cutX)}" y="${n(cutY)}" width="${n(cutW)}" height="${n(FACE_MM + 2 * CUTOUT_GAP)}" rx="1.5"/>`,
    );
    // Заглушки на свободных местах
    for (const gap of row.gaps) {
      out.push(
        `<rect class="blank" data-row="${row.index}" x="${n(gap.x + 0.3)}" y="${n(row.y)}" width="${n(gap.w - 0.6)}" height="${FACE_MM}" rx="1"/>`,
      );
    }
    // Номера модулей над рядом и деления на заглушках
    out.push(moduleGrid(row));
    row.items.forEach((item) => {
      const device = devices.get(item.deviceId);
      const label = deviceLabel(device, t);
      const name = deviceTitle(device, t);
      const selected = item.uid === selectedUid;
      const aria = t('item.position', { title: name, row: row.index + 1, place: formatNumber(item.pos + 1) });
      // Подписи крупные (до 8 и 5 мм), чтобы читались и на телефоне
      const mainSize = fitFont(label.main, item.w, 8);
      const subSize = fitFont(label.sub, item.w, 5);
      out.push(
        `<g class="dev cat-${escapeXml(device.category)}${device.category === 'terminal' ? ` term-${ROLE_CLASS[device.specs.role]}` : ''}${selected ? ' selected' : ''}" transform="translate(${n(item.x)} ${n(row.y)})"` +
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
  // Гребёнки — поверх аппаратов
  for (const bar of combs) {
    out.push(
      `<g class="comb pin-${escapeXml(bar.comb.pinType)}"><title>${escapeXml(`${bar.comb.article} · ${t('comb.title', { phases: bar.comb.phases, length: formatNumber(bar.comb.lengthModules) })}`)}</title>` +
        `<rect class="comb-bar" x="${n(bar.x)}" y="${n(bar.y)}" width="${n(bar.w)}" height="${n(bar.h)}" rx="0.8"/></g>`,
    );
  }
  out.push('</svg>');
  return out.join('');
}
