// Отрисовка щита в SVG: вид спереди со снятой дверцей, в реальных пропорциях.
// Модуль без DOM: раскладка и разметка считаются чистыми функциями (тестируются в Node),
// а результат — строка SVG. Весь текст экранируется.
//
// Единица координат — миллиметр. Размер корпуса берётся из dimensionsMm,
// ширина модуля — 17.5 мм, через лицевую панель видна передняя часть устройств (45 мм).

import { COMB_DEVICE_CATEGORIES } from './catalog.js';

export const MODULE_MM = 17.5;
export const FACE_MM = 45;
const ROW_PITCH_MM = 125; // шаг рядов у типовых модульных щитов
const CUTOUT_GAP = 3; // зазор выреза панели вокруг устройств
// Полоса маркировки над рядом (на ней номера модулей): высота и отступ от выреза.
// Номера кеглем 7.5 мм, как подписи на устройствах: мельче на телефоне не читаются.
const STRIP_MM = 10;
const STRIP_GAP = 3;
// Клеммник N/PE на рисунке: высота (толщина) планки и зазор до рядов
const BAR_MM = 8;
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

// ---------- клеммники N/PE ----------

const clampCount = (clamps) => (clamps ? clamps.reduce((sum, [count]) => sum + count, 0) : null);

/**
 * Клеммники N/PE корпуса на рисунке: [{ role, kind, clamps, article?, x, y, w, h, vertical }].
 * kind: 'included' — в комплекте корпуса; 'accessory' — добавленный аксессуар (board.addTerminals);
 * 'slot' — в комплекте нет, место под клеммник (рисуется пунктиром).
 * clamps — число клемм или null, если неизвестно. Без места в данных — сверху;
 * сбоку, если там не хватает места, — тоже сверху. Несколько клеммников на одном месте — рядом.
 */
export function terminalBars(enclosure, board, layout) {
  const t = enclosure.terminals;
  if (!t || !layout.rows.length) return [];
  const blocks = t.blocks ?? [{ role: 'N+PE' }];
  let items;
  if (t.included) items = blocks.map((b) => ({ role: b.role, kind: 'included', clamps: clampCount(b.clamps), position: b.position }));
  else if (board.addTerminals && t.accessories) {
    items = t.accessories.map((a, i) => ({ role: a.role, kind: 'accessory', clamps: clampCount(a.clamps), article: a.article, position: blocks[i]?.position }));
  } else items = blocks.map((b) => ({ role: b.role, kind: 'slot', clamps: null, position: b.position }));

  const first = layout.rows[0];
  const last = layout.rows[layout.rows.length - 1];
  const sideRoom = first.x0 - CUTOUT_GAP - 8 - COVER_INSET; // место между вырезом (и номером ряда) и краем панели
  const place = (p) => (p === 'left' || p === 'right' ? (sideRoom >= BAR_MM + 2 ? p : 'top') : p ?? 'top');
  const groups = new Map();
  for (const item of items) {
    const p = place(item.position);
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(item);
  }
  const out = [];
  const gap = 3;
  for (const [p, list] of groups) {
    if (p === 'top' || p === 'bottom') {
      const y = p === 'top' ? first.y - CUTOUT_GAP - STRIP_GAP - STRIP_MM - BAR_GAP - BAR_MM : last.y + FACE_MM + CUTOUT_GAP + BAR_GAP;
      const w = (first.x1 - first.x0 - gap * (list.length - 1)) / list.length;
      list.forEach((item, i) => {
        const { position, ...rest } = item;
        out.push({ ...rest, x: first.x0 + i * (w + gap), y, w, h: BAR_MM, vertical: false });
      });
    } else {
      const top = first.y - CUTOUT_GAP;
      const h = (last.y + FACE_MM + CUTOUT_GAP - top - gap * (list.length - 1)) / list.length;
      const x = p === 'left' ? COVER_INSET + (sideRoom - BAR_MM) / 2 : layout.width - COVER_INSET - (sideRoom + BAR_MM) / 2;
      list.forEach((item, i) => {
        const { position, ...rest } = item;
        out.push({ ...rest, x, y: top + i * (h + gap), w: BAR_MM, h, vertical: true });
      });
    }
  }
  return out;
}

const ROLE_CLASS = { N: 'n', PE: 'pe', 'N+PE': 'npe' };

/** Один клеммник: планка (N — синяя, PE — зелёная с жёлтым, N+PE — пополам), подпись и клеммы. */
function terminalBar(bar, t) {
  const cls = `terminal role-${ROLE_CLASS[bar.role]} kind-${bar.kind}`;
  const title =
    bar.kind === 'slot'
      ? t('terminals.slotTitle', { role: bar.role })
      : bar.clamps
        ? t('terminals.title', { role: bar.role, n: bar.clamps })
        : t('terminals.titleUnknown', { role: bar.role });
  const parts = [`<g class="${cls}"><title>${escapeXml(bar.article ? `${title} · ${bar.article}` : title)}</title>`];
  if (bar.kind !== 'slot' && bar.role === 'N+PE') {
    // Общий блок: половина синяя (N), половина зелёная (PE)
    const half = bar.vertical ? { w: bar.w, h: bar.h / 2 } : { w: bar.w / 2, h: bar.h };
    parts.push(`<rect class="bar-n" x="${n(bar.x)}" y="${n(bar.y)}" width="${n(half.w)}" height="${n(half.h)}" rx="1"/>`);
    const x2 = bar.vertical ? bar.x : bar.x + half.w;
    const y2 = bar.vertical ? bar.y + half.h : bar.y;
    parts.push(`<rect class="bar-pe" x="${n(x2)}" y="${n(y2)}" width="${n(half.w)}" height="${n(half.h)}" rx="1"/>`);
  } else {
    parts.push(`<rect class="bar" x="${n(bar.x)}" y="${n(bar.y)}" width="${n(bar.w)}" height="${n(bar.h)}" rx="1"/>`);
  }
  const label = bar.kind === 'slot' ? `${bar.role} · ${t('terminals.notIncluded')}` : bar.role;
  const labelLen = bar.vertical ? 0 : label.length * 3.2 + 3;
  if (!bar.vertical) {
    parts.push(`<text class="terminal-label" x="${n(bar.x + 2)}" y="${n(bar.y + bar.h / 2 + 1.8)}">${escapeXml(label)}</text>`);
  }
  // Клеммы — кружками, если их число известно и они помещаются
  if (bar.kind !== 'slot' && bar.clamps) {
    const length = (bar.vertical ? bar.h : bar.w) - labelLen - 2;
    const step = length / bar.clamps;
    if (step >= 1.6) {
      const r = Math.min(2.2, step / 2.6);
      for (let i = 0; i < bar.clamps; i++) {
        const along = labelLen + 1 + step * (i + 0.5);
        const cx = bar.vertical ? bar.x + bar.w / 2 : bar.x + along;
        const cy = bar.vertical ? bar.y + along : bar.y + bar.h / 2;
        parts.push(`<circle class="clamp" cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"/>`);
      }
    }
  }
  parts.push('</g>');
  return parts.join('');
}

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
 * options: { t, deviceTitle, deviceLabel, title, selectedUid, activeRow, formatNumber, terminals }
 * terminals — клеммники N/PE из terminalBars (необязательно); combs — гребёнки из combBars (необязательно).
 * deviceTitle/deviceLabel — функции из format.js (передаются, чтобы модуль не зависел от переводов);
 * formatNumber — число по правилам языка (номер модуля может быть дробным: 7,5).
 */
export function renderBoardSvg(layout, devices, options) {
  const { t, deviceTitle, deviceLabel, title, selectedUid = null, activeRow = null, formatNumber = String, terminals = [], combs = [] } = options;
  const { width, height } = layout;
  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" class="board-svg" viewBox="0 0 ${n(width)} ${n(height)}" role="group" aria-label="${escapeXml(title)}">`,
  );
  out.push(`<rect class="enc-body" x="0.5" y="0.5" width="${n(width - 1)}" height="${n(height - 1)}" rx="8"/>`);
  out.push(
    `<rect class="enc-cover" x="${COVER_INSET}" y="${COVER_INSET}" width="${n(width - 2 * COVER_INSET)}" height="${n(height - 2 * COVER_INSET)}" rx="4"/>`,
  );

  for (const bar of terminals) out.push(terminalBar(bar, t));

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
