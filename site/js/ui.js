// Интерфейс конструктора: выбор корпуса, щит с рядами, список оборудования, состав щита.
// Вся логика щита — в board.js; здесь только отображение и обработка действий.
// Данные каталога выводятся только как текст (textContent), без вставки HTML.

import {
  createBoard,
  addDevice,
  removeItem,
  moveItem,
  changeEnclosure,
  boardStats,
  findItem,
  billOfMaterials,
  indexById,
  setEarthing,
  setCarriers,
  setRowComb,
  setCombPart,
  clearDevices,
  nearestFreePos,
  snapPos,
  dropPreview,
  BoardError,
} from './board.js';
import {
  deviceLabel,
  deviceTitle,
  categoryName,
  enclosureTitle,
  enclosureDescription,
  enclosureSize,
  deviceRef,
  num,
} from './format.js';
import { h } from './dom.js';
import { layoutBoard, hitTest, renderBoardSvg, slotRect, carrierBars, combBars, MODULE_MM } from './render-svg.js';
import { checkBoard, clampBasis } from './checks.js';
import { specTable, toCsv, exportFileName, carriersSpec, carrierName, insertName, combsSpec, combName, combPartsSpec, combPartName } from './export.js';
import {
  addInsert,
  moveInsert,
  removeInsert,
  transferInsert,
  replaceInsert,
  setInsertRole,
  setCarrierPosition,
  addCarrier,
  removeCarrier,
  swapCarrier,
  carrierOptions,
  addableCarriers,
  insertOptions,
  carrierClamps,
  autoFill,
  clampNeed,
  clampShortage,
  railTerminals,
  railClamps,
  snapInsertPos,
  canPlaceInsert,
  firstFreeInsertPos,
  factoryCarriers,
  markFactory,
  CarrierError,
} from './carriers.js';
import { xlsxWorkbook } from './xlsx.js';
import { filterEnclosures, availableValues, previewSplit, PREVIEW_COUNT } from './enclosure-filter.js';
import { EARTHING_SYSTEMS, COMB_PHASES, COMB_DEVICE_CATEGORIES } from './catalog.js';
import {
  projectFromBoard,
  buildBoard,
  encodeLink,
  projectToFile,
  projectFromFile,
  projectFileName,
  isEmptyProject,
  sameProject,
  ProjectError,
  LINK_PREFIX,
  LIMITS,
} from './storage.js';

export const CATEGORY_ORDER = ['mcb', 'rcbo', 'rcd', 'switch', 'spd', 'terminal', 'distribution'];
const POLE_ORDER = ['1P', '1P+N', '2P', '3P', '3P+N', '4P'];
const DND_TYPE = 'application/x-dinboard';
// Порядок клемм в окне «Клеммы N/PE»
const INSERT_ROLE_ORDER = ['N', 'PE', 'N+PE', 'universal', 'L'];

/** Порядок устройств в списке: серия, полюса, кривая/тип, номинал. */
function compareDevices(a, b) {
  const sa = a.specs;
  const sb = b.specs;
  return (
    a.series.localeCompare(b.series) ||
    POLE_ORDER.indexOf(sa.poles) - POLE_ORDER.indexOf(sb.poles) ||
    String(sa.curve ?? sa.rcdType ?? sa.spdType ?? sa.role).localeCompare(String(sb.curve ?? sb.rcdType ?? sb.spdType ?? sb.role)) ||
    (sa.ratedCurrentA ?? 0) - (sb.ratedCurrentA ?? 0) ||
    a.article.localeCompare(b.article)
  );
}

/**
 * Запускает конструктор.
 * store — хранилище браузера из storage.js (может быть null); initialBoard — восстановленный щит или null;
 * backupText — прежняя версия сохранения, отложенная при открытии (её можно скачать), или null.
 */
export function mountApp(root, { catalog, t: initialT, store = null, initialBoard = null, initialStatus = '', backupText: initialBackup = null }) {
  let t = initialT; // меняется при переключении языка
  const fmt = (value) => num(value, t.lang);
  const devices = indexById(catalog.devices);
  const combsById = indexById(catalog.combs ?? []);
  const partsById = indexById(catalog.combParts ?? []);
  const carriersById = indexById(catalog.terminalCarriers ?? []);
  const insertsById = indexById(catalog.terminalInserts ?? []);
  const carrierCatalog = { carriersById, insertsById };
  const enclosures = indexById(catalog.enclosures);
  const brandNames = new Map(catalog.brands.map((b) => [b.id, b.name]));
  // Значения фильтров корпусов — только те, что есть в каталоге
  const distinct = (key) => [...new Set(catalog.enclosures.map((e) => e[key]))].sort((a, b) => a - b);
  const modulesPerRowOptions = distinct('modulesPerRow');
  const rowsOptions = distinct('rows');

  const state = {
    board: initialBoard,
    activeRow: 0,
    selectedUid: null,
    brand: 'all',
    deviceBrand: null, // фильтр оборудования по производителю; null — как у выбранного корпуса
    mounting: 'all',
    modulesPerRow: 'all', // фильтр корпусов: модулей в ряду
    rowsCount: 'all', // фильтр корпусов: число рядов (DIN-реек)
    category: CATEGORY_ORDER.find((c) => catalog.devices.some((d) => d.category === c)) ?? CATEGORY_ORDER[0],
    poles: 'all',
    status: initialStatus,
    pickerOpen: !initialBoard, // список корпусов развёрнут; после выбора сворачивается до выбранного
    moreOpen: false, // окно «Ещё варианты» с остальными подходящими корпусами
    devicesMoreOpen: false, // окно «Ещё варианты» с остальным оборудованием по фильтрам
    combOpen: false, // окно выбора гребёнки для выделенного ряда
    carriersOpen: false, // окно «Клеммы N/PE»: держатели и клеммы
    selectedInsert: null, // выделенная клемма N/PE: { carrier, item } (индексы в board.carriers)
  };

  let savedBoard = null; // последний сохранённый в браузере щит
  let backupText = initialBackup; // резервная копия прежней версии (или null)
  let autosaveWarned = false;

  const enclosure = () => (state.board ? enclosures.get(state.board.enclosureId) : null);

  // ---------- действия ----------

  /**
   * Меняет состояние и перерисовывает. focusFallback — куда перевести фокус,
   * если элемент, на котором он был, исчез или стал недоступен (например,
   * кнопка «←» на крайней позиции или удалённое устройство).
   */
  function update(changes, focusFallback) {
    Object.assign(state, changes);
    autosave();
    render(focusFallback);
  }

  /** Сохраняет щит в браузере после каждого изменения. Если браузер не даёт — предупреждает один раз. */
  function autosave() {
    if (!store || !state.board || state.board === savedBoard) return;
    savedBoard = state.board;
    if (!store.save(projectFromBoard(state.board)) && !autosaveWarned) {
      autosaveWarned = true;
      state.status = t('project.autosaveOff');
    }
  }

  // ---------- проект: ссылка и файл ----------

  function projectError(err) {
    if (!(err instanceof ProjectError)) throw err;
    return t(`project.error.${err.code}`);
  }

  /** Полная ссылка на текущий щит. */
  function boardUrl() {
    return `${window.location.origin}${window.location.pathname}${LINK_PREFIX}${encodeLink(projectFromBoard(state.board))}`;
  }

  async function copyLink() {
    const url = boardUrl();
    try {
      await navigator.clipboard.writeText(url);
      update({ status: t('project.linkCopied') });
    } catch {
      // Буфер обмена недоступен (нет разрешения или небезопасный адрес) — показываем ссылку для копирования
      window.prompt(t('project.copyPrompt'), url);
    }
  }

  /** Скачивание: data — строка или байты, type — MIME-тип, message(name) — текст в строке статуса после. */
  function saveAs(name, data, type, message) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const link = h('a', { href: url, download: name, hidden: true });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    update({ status: message(name) });
  }

  // ---------- выгрузки: CSV, Excel, печать ----------

  const spec = () => specTable(state.board, enclosure(), devices, brandNames, t, combsById, partsById, carrierCatalog);
  const exported = (name) => t('export.downloaded', { name });
  const projectSaved = (name) => t('project.downloaded', { name });

  function downloadCsv() {
    saveAs(exportFileName(enclosure(), 'csv'), toCsv(spec(), t.lang), 'text/csv;charset=utf-8', exported);
  }

  function downloadXlsx() {
    const book = xlsxWorkbook({ sheet: t('section.summary'), ...spec() });
    saveAs(exportFileName(enclosure(), 'xlsx'), book, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', exported);
  }

  /**
   * Печать (и PDF через «Сохранить как PDF»): выделение снимаем, чтобы его не было на бумаге;
   * перерисовка обновляет дату и ссылку в шапке печати.
   */
  function printBoard() {
    update({ selectedUid: null });
    window.print();
  }

  function downloadFile() {
    saveAs(projectFileName(enclosure()), projectToFile(projectFromBoard(state.board), enclosures, devices), 'application/json', projectSaved);
  }

  /** Прежняя версия сохранения — как есть (обычно это файл проекта). */
  function downloadBackup() {
    saveAs(`dinboard-backup-${new Date().toISOString().slice(0, 10)}.json`, backupText, 'application/json', projectSaved);
  }

  function deleteBackup() {
    if (!window.confirm(t('project.confirmDeleteBackup'))) return;
    store?.clearBackup();
    backupText = null;
    update({ status: t('project.backupDeleted') }, 'project-open');
  }

  function openFile() {
    const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      try {
        if (file.size > LIMITS.textLength) throw new ProjectError('format', { reason: 'size' });
        const project = projectFromFile(await file.text());
        const { board, skipped, oldTerminals } = buildBoard(project, enclosures, devices, carrierCatalog);
        const current = state.board ? projectFromBoard(state.board) : null;
        if (!isEmptyProject(current) && !sameProject(current, projectFromBoard(board)) && !window.confirm(t('project.confirmReplace'))) {
          return;
        }
        update({
          board,
          selectedUid: null,
          selectedInsert: null,
          activeRow: 0,
          pickerOpen: false,
          status: [skipped.length ? t('project.loadedSkipped', { n: skipped.length }) : t('project.loaded'), oldTerminals && t('project.oldTerminals')]
            .filter(Boolean)
            .join(' '),
        });
      } catch (err) {
        update({ status: projectError(err) });
      }
    });
    input.addEventListener('cancel', () => input.remove());
    document.body.append(input);
    input.click();
  }

  function reportError(err, title) {
    if (!(err instanceof BoardError)) throw err;
    if (err.code === 'no-space') {
      return err.details.row === undefined
        ? t('status.noSpaceAny', { title })
        : t('status.noSpace', { row: err.details.row + 1 });
    }
    if (err.code === 'occupied') return t('status.occupied', { title });
    return t('status.error');
  }

  function selectEnclosure(id) {
    const next = enclosures.get(id);
    if (!state.board) {
      update({ board: createBoard(next), activeRow: 0, selectedUid: null, selectedInsert: null, status: '', pickerOpen: false, moreOpen: false });
      return;
    }
    if (state.board.enclosureId === id) {
      update({ pickerOpen: false, moreOpen: false });
      return;
    }
    const { board, overflow } = changeEnclosure(state.board, next, devices, carriersById, insertsById);
    if (overflow.length && !window.confirm(t('enclosure.confirmOverflow', { n: overflow.length }))) return;
    update({
      board,
      pickerOpen: false,
      moreOpen: false,
      activeRow: Math.min(state.activeRow, board.rows.length - 1),
      selectedUid: findItem(board, state.selectedUid) ? state.selectedUid : null,
      selectedInsert: null,
      status: overflow.length
        ? t('enclosure.overflowRemoved', { n: overflow.length })
        : t('enclosure.changed', { title: enclosureTitle(next) }),
    });
  }

  /** Добавляет устройство: на место pos ряда row, а без pos — на первое свободное место ряда. */
  function add(deviceId, row = state.activeRow, pos) {
    const title = deviceTitle(devices.get(deviceId), t);
    try {
      const result = addDevice(state.board, enclosure(), devices, deviceId, { row, pos });
      update({ board: result.board, selectedUid: result.uid, activeRow: row, status: t('status.added', { title }) });
    } catch (err) {
      // В выбранном ряду нет места — пробуем любой ряд с местом (но не при сбросе на конкретное место)
      if (err instanceof BoardError && err.code === 'no-space' && pos === undefined) {
        try {
          const result = addDevice(state.board, enclosure(), devices, deviceId);
          const to = findItem(result.board, result.uid).row;
          update({
            board: result.board,
            selectedUid: result.uid,
            activeRow: to,
            status: t('status.addedToRow', { from: row + 1, to: to + 1, title }),
          });
          return;
        } catch (inner) {
          update({ status: reportError(inner, title) });
          return;
        }
      }
      update({ status: reportError(err, title) });
    }
  }

  /** Устройство по uid: { row, index, item, device } или null. */
  function locate(uid) {
    const at = findItem(state.board, uid);
    if (!at) return null;
    const item = state.board.rows[at.row][at.index];
    return { ...at, item, device: devices.get(item.deviceId) };
  }

  /** Переносит устройство на место toPos ряда toRow (в модулях). Занято — отказ с сообщением. */
  function move(uid, toRow, toPos) {
    const at = locate(uid);
    if (!at) return;
    const title = deviceTitle(at.device, t);
    if (toPos === null) {
      update({ status: t('status.noSpace', { row: toRow + 1 }) });
      return;
    }
    try {
      const board = moveItem(state.board, enclosure(), devices, uid, toRow, toPos);
      update(
        { board, selectedUid: uid, activeRow: toRow, status: t('status.moved', { title, row: toRow + 1, place: fmt(toPos + 1) }) },
        `item-${uid}`,
      );
    } catch (err) {
      update({ status: reportError(err, title) });
    }
  }

  /**
   * Куда сдвинуть кнопкой: ← → — на шаг в сторону или через соседа до ближайшего свободного места;
   * ↑ ↓ — в соседний ряд, на ближайшее к нынешнему свободное место. null — некуда.
   */
  function stepTarget(at, dRow, dPos) {
    const width = at.device.modules;
    if (dRow === 0) {
      return nearestFreePos(state.board, enclosure(), devices, at.row, width, at.item.pos + dPos, {
        ignoreUid: at.item.uid,
        direction: dPos,
        from: at.item.pos,
      });
    }
    return nearestFreePos(state.board, enclosure(), devices, at.row + dRow, width, at.item.pos);
  }

  function remove(uid) {
    const at = findItem(state.board, uid);
    if (!at) return;
    const title = deviceTitle(devices.get(state.board.rows[at.row][at.index].deviceId), t);
    const board = removeItem(state.board, uid);
    // Фокус — на соседнее устройство в том же ряду, а если ряд опустел — на кнопку ряда
    const row = board.rows[at.row];
    const neighbour = row[Math.min(at.index, row.length - 1)];
    update(
      { board, selectedUid: null, status: t('status.removed', { title }) },
      neighbour ? `item-${neighbour.uid}` : `row-${at.row}`,
    );
  }

  function clearBoard() {
    if (!window.confirm(t('board.confirmClear'))) return;
    // Система заземления и держатели клемм N/PE при очистке сохраняются
    const board = clearDevices(state.board, enclosure());
    update({ board, selectedUid: null, selectedInsert: null, activeRow: 0, status: t('board.cleared') });
  }

  /**
   * «Начать заново»: всё с нуля — корпус не выбран, фильтры по умолчанию, сохранение в браузере убрано.
   * Прежний щит откладывается в резервную копию: его можно скачать кнопкой «Скачать прежнюю версию».
   */
  function startOver() {
    if (!window.confirm(t('board.confirmReset'))) return;
    const text = projectToFile(projectFromBoard(state.board), enclosures, devices);
    store?.saveBackup(text);
    backupText = text;
    store?.clear();
    savedBoard = null;
    update(
      {
        board: null,
        selectedUid: null,
        selectedInsert: null,
        activeRow: 0,
        brand: 'all',
        deviceBrand: null,
        mounting: 'all',
        modulesPerRow: 'all',
        rowsCount: 'all',
        poles: 'all',
        pickerOpen: true,
        moreOpen: false,
        devicesMoreOpen: false,
        combOpen: false,
        carriersOpen: false,
        status: t('board.resetDone'),
      },
      'project-open',
    );
  }

  // ---------- перетаскивание ----------
  // Из списка оборудования в щит — HTML5 Drag and Drop (мышь).
  // Внутри щита — Pointer Events: работает и мышью, и пальцем.

  // Какое устройство тянут из списка: во время dragover браузер не отдаёт данные перетаскивания,
  // а ширина нужна, чтобы показать, сколько модулей оно займёт
  let paletteDragId = null;
  const dragStart = (payload) => (event) => {
    event.dataTransfer.setData(DND_TYPE, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'copy';
    paletteDragId = payload.deviceId;
    event.target.addEventListener('dragend', () => (paletteDragId = null), { once: true });
  };

  /** Точка экрана → координаты щита в мм. */
  function toBoardPoint(svg, clientX, clientY) {
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    return new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  }

  function markDropRow(svg, row) {
    for (const el of svg.querySelectorAll('.cutout')) el.classList.toggle('drop-target', Number(el.dataset.row) === row);
  }

  /**
   * Подсказка места при перетаскивании: прямоугольник на модулях, которые займёт устройство;
   * зелёный — место свободно, красный — занято (там будет отказ). preview — из dropPreview или null.
   */
  function showDropSlot(svg, layout, row, preview, width) {
    svg.querySelector('.drop-slot')?.remove();
    if (!preview) return;
    const r = slotRect(layout, row, preview.pos, width);
    if (!r) return;
    const slot = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    slot.setAttribute('class', `drop-slot ${preview.ok ? 'ok' : 'bad'}`);
    const attrs = { x: r.x + 0.3, y: r.y - 1, width: r.w - 0.6, height: r.h + 2, rx: 1.5 };
    for (const [k, v] of Object.entries(attrs)) slot.setAttribute(k, String(v));
    svg.append(slot);
  }

  /**
   * Переносит устройство uid туда, где его отпустили: ряд — по точке указателя,
   * место — по сдвигу устройства (dxMm), с притяжением к модулям и краям соседей.
   */
  function dropExisting(uid, hit, dxMm) {
    const at = locate(uid);
    if (!at) return;
    if (!hit) {
      render(); // отпустили за пределами щита — отмена, устройство возвращается на место
      return;
    }
    const raw = at.item.pos + dxMm / MODULE_MM;
    const pos = snapPos(state.board, enclosure(), devices, hit.row, raw, at.device.modules, uid);
    if (hit.row === at.row && pos === at.item.pos) {
      render(); // положили на то же место — просто вернуть на место
      return;
    }
    move(uid, hit.row, pos);
  }

  /** Выделить клемму N/PE на рисунке (повторно — снять выделение). */
  function toggleInsert(sel) {
    const same = state.selectedInsert?.carrier === sel.carrier && state.selectedInsert?.item === sel.item;
    update({ selectedInsert: same ? null : sel, selectedUid: null });
  }

  function bindBoardEvents(view, svg, layout, bars) {
    let drag = null;
    let suppressClick = false;
    const barOf = (index) => bars.find((b) => b.index === index);

    /**
     * Куда встанет клемма sel, если отпустить её сейчас: { to, pos, ok }. to — держатель под указателем
     * (p — точка в мм; не над держателем — свой), pos — место в нём (притягивание как у snapInsertPos),
     * ok — клемма к нему подходит и место свободно. dxMm — сдвиг по горизонтали.
     */
    function insertTarget(sel, p, dxMm) {
      const at = locateInsert(sel);
      const from = barOf(sel.carrier);
      if (!at || !from) return null;
      const over = p ? bars.find((b) => !b.slot && p.y >= b.y - 6 && p.y <= b.y + b.h + 6 && p.x >= b.x - 6 && p.x <= b.x + b.w + 6) : null;
      const target = over ?? from;
      const same = target.index === sel.carrier;
      const carrier = carrierList()[target.index];
      const raw = from.x + at.item.pos + dxMm - target.x;
      const pos = snapInsertPos(carrier, carriersById, insertsById, raw, at.insert.widthMm, same ? sel.item : -1);
      const fits = !at.insert.carrierIds || at.insert.carrierIds.includes(carrier.carrierId);
      const ok = fits && pos !== null && canPlaceInsert(carrier, carriersById, insertsById, pos, at.insert.widthMm, same ? sel.item : -1);
      return { to: target.index, bar: target, pos, ok };
    }

    view.addEventListener('pointerdown', (event) => {
      // Клемма N/PE: тянется вдоль держателя или в другой держатель (части заводской колодки — нет)
      const ins = event.target.closest?.('.insert');
      if (ins) {
        if (event.button !== 0 || ins.classList.contains('fixed')) return;
        const sel = { carrier: Number(ins.dataset.carrier), item: Number(ins.dataset.insert) };
        drag = { insert: sel, dev: ins, x: event.clientX, y: event.clientY, id: event.pointerId, moved: false };
        return;
      }
      const dev = event.target.closest?.('.dev');
      if (!dev || event.button !== 0) return;
      drag = { uid: Number(dev.dataset.uid), dev, x: event.clientX, y: event.clientY, id: event.pointerId, moved: false };
    });

    view.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < 6) return;
        drag.moved = true;
        drag.base = drag.dev.getAttribute('transform');
        drag.dev.classList.add('dragging');
        try {
          // Указатель остаётся «привязан» к устройству, даже если ушёл за пределы щита
          drag.dev.setPointerCapture(event.pointerId);
        } catch {
          // Не критично: события всё равно доходят до контейнера щита
        }
      }
      event.preventDefault();
      const scale = 1 / (svg.getScreenCTM()?.a || 1);
      if (drag.insert) {
        // Подсказка — где клемма встанет, если отпустить сейчас (в своём держателе или в том, что под указателем)
        drag.dev.setAttribute('transform', `translate(${dx * scale} ${dy * scale})`);
        const at = locateInsert(drag.insert);
        const target = insertTarget(drag.insert, toBoardPoint(svg, event.clientX, event.clientY), dx * scale);
        if (!at || !target) return;
        showInsertSlot(svg, target.bar, target.pos, at.insert.widthMm, target.ok);
        return;
      }
      drag.dev.setAttribute('transform', `${drag.base} translate(${dx * scale} ${dy * scale})`);
      const p = toBoardPoint(svg, event.clientX, event.clientY);
      const hit = p ? hitTest(layout, p.x, p.y) : null;
      markDropRow(svg, hit?.row);
      // Где устройство встанет, если отпустить сейчас (тот же расчёт, что в dropExisting)
      const at = locate(drag.uid);
      const preview =
        hit && at ? dropPreview(state.board, enclosure(), devices, hit.row, at.item.pos + (dx * scale) / MODULE_MM, at.device.modules, drag.uid) : null;
      showDropSlot(svg, layout, hit?.row, preview, at?.device.modules);
    });

    const finish = (event, cancelled) => {
      if (!drag || event.pointerId !== drag.id) return;
      const current = drag;
      drag = null;
      if (!current.moved) return; // это был клик — его обработает click
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
      if (cancelled) {
        render();
        return;
      }
      const p = toBoardPoint(svg, event.clientX, event.clientY);
      const scale = 1 / (svg.getScreenCTM()?.a || 1);
      if (current.insert) {
        // Отпустили за пределами щита — отмена
        if (!p || p.x < 0 || p.y < 0 || p.x > layout.width || p.y > layout.height) {
          render();
          return;
        }
        const target = insertTarget(current.insert, p, (event.clientX - current.x) * scale);
        if (target && target.to !== current.insert.carrier) transferInsertTo(current.insert, target.to, target.pos);
        else dropInsert(current.insert, (event.clientX - current.x) * scale);
        return;
      }
      dropExisting(current.uid, p ? hitTest(layout, p.x, p.y) : null, (event.clientX - current.x) * scale);
    };
    view.addEventListener('pointerup', (event) => finish(event, false));
    view.addEventListener('pointercancel', (event) => finish(event, true));

    view.addEventListener('click', (event) => {
      if (suppressClick) return;
      const ins = event.target.closest?.('.insert');
      if (ins) {
        toggleInsert({ carrier: Number(ins.dataset.carrier), item: Number(ins.dataset.insert) });
        return;
      }
      const dev = event.target.closest?.('.dev');
      if (dev) {
        const uid = Number(dev.dataset.uid);
        const at = findItem(state.board, uid);
        if (at) update({ selectedUid: state.selectedUid === uid ? null : uid, selectedInsert: null, activeRow: at.row });
        return;
      }
      const rowEl = event.target.closest?.('[data-row]');
      if (rowEl) update({ activeRow: Number(rowEl.dataset.row), selectedUid: null });
    });

    view.addEventListener('keydown', (event) => {
      const ins = event.target.closest?.('.insert');
      if (ins) {
        const sel = { carrier: Number(ins.dataset.carrier), item: Number(ins.dataset.insert) };
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleInsert(sel);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          nudgeInsert(sel, event.key === 'ArrowLeft' ? -1 : 1, event.shiftKey);
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          removeInsertAt(sel);
        }
        return;
      }
      const dev = event.target.closest?.('.dev');
      if (!dev) return;
      const uid = Number(dev.dataset.uid);
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const at = findItem(state.board, uid);
        if (at) update({ selectedUid: state.selectedUid === uid ? null : uid, activeRow: at.row });
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        remove(uid);
      }
    });

    // Перетаскивание из списка оборудования
    view.addEventListener('dragover', (event) => {
      if (!event.dataTransfer.types.includes(DND_TYPE)) return;
      event.preventDefault();
      const p = toBoardPoint(svg, event.clientX, event.clientY);
      const hit = p ? hitTest(layout, p.x, p.y) : null;
      markDropRow(svg, hit?.row);
      // Середина устройства — под указателем (как при отпускании)
      const width = paletteDragId && devices.has(paletteDragId) ? devices.get(paletteDragId).modules : null;
      const preview = hit && width ? dropPreview(state.board, enclosure(), devices, hit.row, hit.offset - width / 2, width) : null;
      showDropSlot(svg, layout, hit?.row, preview, width);
    });
    view.addEventListener('dragleave', (event) => {
      if (!view.contains(event.relatedTarget)) {
        markDropRow(svg, null);
        showDropSlot(svg, layout, null, null);
      }
    });
    view.addEventListener('drop', (event) => {
      const raw = event.dataTransfer.getData(DND_TYPE);
      if (!raw) return;
      event.preventDefault();
      markDropRow(svg, null);
      showDropSlot(svg, layout, null, null);
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }
      const p = toBoardPoint(svg, event.clientX, event.clientY);
      const hit = p ? hitTest(layout, p.x, p.y) : null;
      if (!hit || typeof data.deviceId !== 'string' || !devices.has(data.deviceId)) return;
      // Середина устройства — под указателем
      const width = devices.get(data.deviceId).modules;
      const pos = snapPos(state.board, enclosure(), devices, hit.row, hit.offset - width / 2, width);
      if (pos === null) update({ status: t('status.noSpace', { row: hit.row + 1 }) });
      else add(data.deviceId, hit.row, pos);
    });
  }

  /** Вставляет SVG-строку как узлы (через XML-парсер, без innerHTML). */
  function svgNode(markup) {
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error('SVG parse error');
    return document.importNode(doc.documentElement, true);
  }

  // ---------- отрисовка ----------

  /** Группа кнопок-вариантов. options: [key, text, disabled?] — недоступный вариант серый и не нажимается. */
  function chips(label, value, options, onPick) {
    return h(
      'div',
      { class: 'chips', role: 'group', 'aria-label': label },
      options.map(([key, text, disabled = false]) =>
        h(
          'button',
          {
            type: 'button',
            class: 'chip',
            'aria-pressed': String(value === key),
            disabled,
            dataset: { focus: `chip-${label}-${key}` },
            onClick: () => onPick(key),
          },
          text,
        ),
      ),
    );
  }

  function enclosureCard(e) {
    return h(
      'button',
      {
        type: 'button',
        class: 'enclosure-card',
        'aria-pressed': String(state.board?.enclosureId === e.id),
        dataset: { focus: `enc-${e.id}` },
        onClick: () => selectEnclosure(e.id),
      },
      h('span', { class: 'enclosure-icon', 'aria-hidden': 'true' }, Array.from({ length: e.rows }, () => h('span'))),
      h(
        'span',
        { class: 'enclosure-text' },
        h('strong', {}, `${brandNames.get(e.brand)} ${enclosureTitle(e)}`),
        h('span', {}, enclosureDescription(e, t)),
        h(
          'span',
          { class: 'muted' },
          enclosureSize(e, t),
          !e.verified && h('span', { class: 'badge', title: t('enclosure.unverifiedHint') }, t('device.unverified')),
        ),
      ),
    );
  }

  function renderEnclosurePicker() {
    const heading = h('h2', { id: 'h-enclosure' }, t('section.enclosure'));
    const current = enclosure();
    if (current && !state.pickerOpen) {
      return h(
        'section',
        { class: 'panel picker', 'aria-labelledby': 'h-enclosure' },
        heading,
        h('div', { class: 'enclosure-current' }, enclosureCard(current)),
        h(
          'button',
          { type: 'button', class: 'action picker-toggle', 'aria-expanded': 'false', dataset: { focus: 'picker-toggle' }, onClick: () => update({ pickerOpen: true }) },
          t('enclosure.change'),
        ),
      );
    }
    const filters = { brand: state.brand, mounting: state.mounting, modulesPerRow: state.modulesPerRow, rowsCount: state.rowsCount };
    const list = filterEnclosures(catalog.enclosures, filters);
    const { shown, rest } = previewSplit(list, PREVIEW_COUNT, state.board?.enclosureId ?? null);
    // Вариант фильтра недоступен, если вместе с остальными выбранными фильтрами не найдётся ни одного корпуса
    const options = (key, values) => {
      const available = availableValues(catalog.enclosures, filters, key);
      return [['all', t('filter.all')], ...values.map(([value, text]) => [value, text, !available.has(value)])];
    };
    return h(
      'section',
      { class: 'panel picker', 'aria-labelledby': 'h-enclosure' },
      heading,
      catalog.brands.length > 1 &&
        chips(t('filter.brand'), state.brand, options('brand', catalog.brands.map((b) => [b.id, b.name])), (brand) => update({ brand })),
      chips(
        t('filter.mounting'),
        state.mounting,
        options('mounting', [['surface', t('mounting.surface')], ['flush', t('mounting.flush')]]),
        (mounting) => update({ mounting }),
      ),
      // Подписи над числовыми фильтрами: без них «12 13 18» и «1 2 3 4» непонятны
      modulesPerRowOptions.length > 1 && h('p', { class: 'muted filter-label' }, t('filter.modulesPerRow')),
      modulesPerRowOptions.length > 1 &&
        chips(
          t('filter.modulesPerRow'),
          state.modulesPerRow,
          options('modulesPerRow', modulesPerRowOptions.map((m) => [m, String(m)])),
          (modulesPerRow) => update({ modulesPerRow }),
        ),
      rowsOptions.length > 1 && h('p', { class: 'muted filter-label' }, t('filter.rows')),
      rowsOptions.length > 1 &&
        chips(
          t('filter.rows'),
          state.rowsCount,
          options('rowsCount', rowsOptions.map((r) => [r, String(r)])),
          (rowsCount) => update({ rowsCount }),
        ),
      // Пустой список возможен только при пустом каталоге: недоступные варианты фильтров не нажимаются
      list.length
        ? h('ul', { class: 'enclosure-list' }, shown.map((e) => h('li', {}, enclosureCard(e))))
        : h('p', { class: 'hint' }, t('enclosure.noneFound')),
      // Кнопки под списком: «Ещё варианты» и «Оставить текущий корпус» — в один ряд, на узком экране переносятся
      (rest.length > 0 || current) &&
        h(
          'div',
          { class: 'picker-actions' },
          rest.length > 0 &&
            h(
              'button',
              { type: 'button', class: 'action', 'aria-haspopup': 'dialog', dataset: { focus: 'enc-more' }, onClick: () => update({ moreOpen: true }) },
              t('enclosure.more', { n: rest.length }),
            ),
          current &&
            h(
              'button',
              { type: 'button', class: 'action picker-toggle', 'aria-expanded': 'true', dataset: { focus: 'picker-toggle' }, onClick: () => update({ pickerOpen: false }) },
              t('enclosure.keep'),
            ),
        ),
      rest.length > 0 &&
        state.moreOpen &&
        moreDialog({
          titleId: 'h-enclosure-more',
          title: t('enclosure.moreTitle', { n: rest.length }),
          stateKey: 'moreOpen',
          focusKey: 'enc-more',
          content: h('ul', { class: 'enclosure-list' }, rest.map((e) => h('li', {}, enclosureCard(e)))),
        }),
    );
  }

  /**
   * Окно «Ещё варианты» (корпуса или оборудование): titleId/title — заголовок, stateKey — поле состояния
   * «окно открыто», focusKey — кнопка, открывающая окно, content — содержимое. Встроенный <dialog> (showModal — в render):
   * Esc и ✕ закрывают, Tab не выходит из окна, щелчок мимо окна (по подложке) тоже закрывает.
   */
  function moreDialog({ titleId, title, stateKey, focusKey, content }) {
    const dialog = h(
      'dialog',
      { class: 'more-dialog', 'aria-labelledby': titleId },
      h(
        'div',
        { class: 'dialog-body' },
        h(
          'div',
          { class: 'dialog-head' },
          h('h2', { id: titleId }, title),
          h(
            'button',
            { type: 'button', class: 'tool dialog-close', 'aria-label': t('dialog.close'), title: t('dialog.close'), dataset: { focus: `${focusKey}-close` }, onClick: () => closeDialog() },
            '✕',
          ),
        ),
        content,
      ),
    );
    // Щелчок по подложке приходит на сам <dialog>. Но и щелчок по пустому месту внутри окна
    // (на телефоне окно во весь экран, а список короче) — тоже, поэтому закрываем,
    // только если точка вне прямоугольника окна.
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      const inside = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
      if (!inside) closeDialog();
    });
    // Esc — сами, не дожидаясь события close (в фоновой или скрытой вкладке оно может не прийти)
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeDialog();
    });
    // Запасной путь: окно закрыл браузер (например, своим жестом «назад»)
    dialog.addEventListener('close', () => closeDialog());
    return dialog;

    // Закрытие (✕, подложка, Esc): окно закрывается и состояние сбрасывается сразу.
    // Окно, убранное перерисовкой, состояние не трогает. После закрытия фокус — на кнопку
    // «Ещё варианты» (прежний фокус браузер вернуть не может: кнопку перерисовали).
    function closeDialog() {
      if (dialog.open) dialog.close();
      if (!dialog.isConnected || !state[stateKey]) return;
      update({ [stateKey]: false });
      root.querySelector(`[data-focus="${focusKey}"]`)?.focus();
    }
  }

  function renderToolbar() {
    const at = locate(state.selectedUid);
    if (!at) return null;
    const { device } = at;
    const uid = state.selectedUid;
    const left = stepTarget(at, 0, -1);
    const right = stepTarget(at, 0, 1);
    const tool = (key, text, disabled, action) =>
      h('button', { type: 'button', class: 'tool', 'aria-label': t(key), title: t(key), disabled, dataset: { focus: `tool-${key}` }, onClick: action }, text);
    return h(
      'div',
      { class: 'toolbar', role: 'toolbar', 'aria-label': t('item.selected', { title: deviceTitle(device, t) }) },
      h('span', { class: 'toolbar-title' }, t('item.selected', { title: `${deviceTitle(device, t)} (${device.article})` })),
      h(
        'span',
        { class: 'toolbar-buttons' },
        tool('item.moveLeft', '←', left === null, () => move(uid, at.row, left)),
        tool('item.moveRight', '→', right === null, () => move(uid, at.row, right)),
        // Вверх и вниз доступны всегда (кроме крайних рядов): если места нет — сообщение
        tool('item.moveUp', '↑', at.row === 0, () => move(uid, at.row - 1, stepTarget(at, -1, 0))),
        tool('item.moveDown', '↓', at.row === state.board.rows.length - 1, () => move(uid, at.row + 1, stepTarget(at, 1, 0))),
        tool('item.remove', '✕', false, () => remove(uid)),
      ),
    );
  }

  function renderBoardView(enc) {
    const layout = layoutBoard(enc, state.board, devices);
    // Держателей нет, а в корпус их можно поставить — место пунктиром
    const bars = carrierBars(state.board, layout, carriersById, insertsById, { emptySlot: carrierOptions(enc, carriersById).length > 0 });
    const svg = svgNode(
      renderBoardSvg(layout, devices, {
        t,
        deviceTitle,
        deviceLabel,
        title: `${brandNames.get(enc.brand)} ${enclosureTitle(enc)}`,
        selectedUid: state.selectedUid,
        activeRow: state.activeRow,
        formatNumber: fmt,
        carriers: bars,
        selectedInsert: state.selectedInsert,
        combs: combBars(layout, state.board, combsById, devices),
      }),
    );
    const view = h('div', { class: `board-view${state.selectedUid !== null ? ' has-selection' : ''}` }, svg);
    bindBoardEvents(view, svg, layout, bars);
    return view;
  }

  /**
   * Гребёнка выделенного ряда: что выбрано и кнопка выбора. В окне — гребёнки производителя
   * аппаратов ряда (иначе — производителя корпуса) и «Без гребёнки».
   */
  function renderRowComb(enc) {
    const row = state.activeRow;
    const id = state.board.combs?.[row] ?? null;
    const comb = id ? combsById.get(id) : null;
    const inRow = (state.board.rows[row] ?? []).map((item) => devices.get(item.deviceId)).filter((d) => d && COMB_DEVICE_CATEGORIES.has(d.category));
    const brand = inRow[0]?.brand ?? enc.brand;
    const options = catalog.combs
      ? catalog.combs
          .filter((c) => c.brand === brand)
          .sort((a, b) => COMB_PHASES.indexOf(a.phases) - COMB_PHASES.indexOf(b.phases) || a.pinType.localeCompare(b.pinType) || a.lengthModules - b.lengthModules || a.article.localeCompare(b.article))
      : [];
    const pick = (combId) =>
      update(
        {
          board: setRowComb(state.board, row, combId),
          combOpen: false,
          status: combId ? t('comb.set', { row: row + 1, name: combName(combsById.get(combId), t) }) : t('comb.removed', { row: row + 1 }),
        },
        'comb-pick',
      );
    return h(
      'div',
      { class: 'row-comb' },
      h('span', { class: 'muted' }, t('comb.rowLabel', { n: row + 1 })),
      h('strong', {}, comb ? `${combName(comb, t)} · ${comb.article}` : id ? id : t('comb.none')),
      h(
        'button',
        { type: 'button', class: 'action', 'aria-haspopup': 'dialog', dataset: { focus: 'comb-pick' }, onClick: () => update({ combOpen: true, status: '' }) },
        t('comb.choose'),
      ),
      state.combOpen &&
        moreDialog({
          titleId: 'h-comb',
          title: t('comb.dialogTitle', { n: row + 1 }),
          stateKey: 'combOpen',
          focusKey: 'comb-pick',
          content: [
            id && h('button', { type: 'button', class: 'action comb-remove', dataset: { focus: 'comb-remove' }, onClick: () => pick(null) }, t('comb.remove')),
            options.length
              ? h(
                  'ul',
                  { class: 'device-list' },
                  options.map((c) => {
                    const name = combName(c, t);
                    return h(
                      'li',
                      { class: 'device-row' },
                      h(
                        'span',
                        { class: 'device-text' },
                        h('strong', {}, name),
                        h(
                          'span',
                          { class: 'muted' },
                          `${c.article} · ${c.deviceSeries ? t('comb.series', { list: c.deviceSeries.join(', ') }) : t('comb.seriesUnknown')}`,
                          !c.verified && h('span', { class: 'badge', title: t('device.unverifiedHint') }, t('device.unverified')),
                        ),
                      ),
                      h(
                        'button',
                        { type: 'button', class: 'action', 'aria-pressed': String(c.id === id), 'aria-label': t('comb.pickTitle', { name: `${name} · ${c.article}` }), dataset: { focus: `comb-${c.id}` }, onClick: () => pick(c.id) },
                        t('comb.pick'),
                      ),
                    );
                  }),
                )
              : h('p', { class: 'hint' }, t('comb.noneForBrand')),
            renderCombParts(brand, comb),
          ],
        }),
    );
  }

  /**
   * Аксессуары гребёнок в окне выбора: заглушки, вводные клеммы, колпачки производителя ряда
   * (к серии выбранной гребёнки, а без неё — ко всем гребёнкам бренда), количество — кнопками − и +.
   */
  function renderCombParts(brand, comb) {
    const list = (catalog.combParts ?? []).filter((p) => p.brand === brand && (!comb || p.combSeries.includes(comb.series)));
    if (!list.length) return null;
    const count = (id) => state.board.combParts?.[id] ?? 0;
    // На 0 кнопка «−» выключается (на 99 — «+»): фокус — на соседнюю кнопку, а не на ✕ окна
    const set = (p, n) =>
      update(
        { board: setCombPart(state.board, p.id, n), status: t('combPart.set', { name: `${combPartName(p, t)} · ${p.article}`, n }) },
        n === 0 ? `part-more-${p.id}` : n === 99 ? `part-less-${p.id}` : undefined,
      );
    return [
      h('h3', { class: 'comb-parts-title' }, t('combPart.title')),
      h(
        'ul',
        { class: 'device-list' },
        list.map((p) => {
          const name = `${combPartName(p, t)} · ${p.article}`;
          const n = count(p.id);
          return h(
            'li',
            { class: 'device-row' },
            h(
              'span',
              { class: 'device-text' },
              h('strong', {}, combPartName(p, t)),
              h('span', { class: 'muted' }, `${p.article} · ${p.series}`, !p.verified && h('span', { class: 'badge', title: t('device.unverifiedHint') }, t('device.unverified'))),
            ),
            h(
              'span',
              { class: 'stepper', role: 'group', 'aria-label': name },
              h('button', { type: 'button', class: 'tool', disabled: n === 0, 'aria-label': t('combPart.less', { name }), dataset: { focus: `part-less-${p.id}` }, onClick: () => set(p, n - 1) }, '−'),
              h('span', { class: 'stepper-count', 'aria-live': 'polite' }, String(n)),
              h('button', { type: 'button', class: 'tool', disabled: n >= 99, 'aria-label': t('combPart.more', { name }), dataset: { focus: `part-more-${p.id}` }, onClick: () => set(p, n + 1) }, '+'),
            ),
          );
        }),
      ),
    ];
  }

  /** Проверки щита: система заземления и подсказки (не мешают сборке). */
  function renderChecks(enc) {
    const list = checkBoard(state.board, enc, devices, combsById, carrierCatalog);
    const items = list.map((check) => {
      const params = { ...check.params };
      if (typeof params.free === 'number') params.free = fmt(params.free);
      // Пояснение «нужно клемм» — слагаемые [[ключ, число]] из checks.js
      if (Array.isArray(params.basis)) params.basis = basisText(params.basis);
      if (check.deviceId) {
        const d = devices.get(check.deviceId);
        params.title = `${deviceTitle(d, t)} — ${deviceRef(d, brandNames.get(d.brand))}`;
      }
      return h(
        'li',
        { class: `check check-${check.level}` },
        h('span', { class: 'check-icon', 'aria-hidden': 'true' }, check.level === 'warning' ? '!' : 'i'),
        // Уровень подсказки — текстом для программ чтения с экрана (значок скрыт от них)
        h('span', { class: 'visually-hidden' }, t(`check.level.${check.level}`)),
        h('span', {}, t(check.key, params)),
      );
    });
    return h(
      'section',
      { class: 'checks', 'aria-labelledby': 'h-checks' },
      h('h3', { id: 'h-checks' }, t('check.title')),
      h('p', { class: 'muted checks-label' }, t('earthing.label')),
      chips(
        t('earthing.label'),
        state.board.earthing ?? 'none',
        [['none', t('earthing.none')], ...EARTHING_SYSTEMS.map((e) => [e, e])],
        (value) => update({ board: setEarthing(state.board, value === 'none' ? null : value) }),
      ),
      renderCarriers(enc),
      items.length ? h('ul', { class: 'check-list' }, items) : h('p', { class: 'check-ok' }, t('check.ok')),
    );
  }

  // ---------- держатели клемм N/PE ----------

  const carrierList = () => state.board.carriers ?? [];
  /** Выделенная клемма: { sel, carrier, item, insert, catalogCarrier } или null (если её уже нет). */
  function locateInsert(sel = state.selectedInsert) {
    if (!sel || !state.board) return null;
    const carrier = carrierList()[sel.carrier];
    const item = carrier?.inserts[sel.item];
    const insert = item && insertsById.get(item.insertId);
    if (!insert) return null;
    return { sel, carrier, item, insert, catalogCarrier: carriersById.get(carrier.carrierId) };
  }
  const roleOf = (item, insert) => (insert.role === 'universal' ? item.role ?? 'N' : insert.role);
  const insertLabel = (item, insert) => `${insertName(insert, roleOf(item, insert), t)}${insert.article ? ` (${insert.article})` : ''}`;

  /**
   * Изменение держателей: fn(carriers) → новые держатели. Отказ (занято, не помещается) — сообщением.
   * select(next) — какую клемму выделить после (или null).
   */
  function changeCarriers(fn, status, { focus, select } = {}) {
    let next;
    try {
      next = fn(carrierList());
    } catch (err) {
      if (!(err instanceof CarrierError)) throw err;
      update({ status: t(`carrier.error.${err.code}`) });
      return;
    }
    // «В комплекте корпуса» — по комплектации корпуса, как после открытия ссылки или файла
    const changes = { board: setCarriers(state.board, markFactory(next, enclosure())), status };
    if (select !== undefined) changes.selectedInsert = typeof select === 'function' ? select(next) : select;
    update(changes, focus);
  }

  /** Индекс клеммы insertId на позиции pos в держателе (после сортировки он меняется). */
  const findInsert = (carriers, index, insertId, pos) => {
    const item = carriers[index]?.inserts.findIndex((x) => x.insertId === insertId && Math.abs(x.pos - pos) < 1e-6);
    return item >= 0 ? { carrier: index, item } : null;
  };

  /** Переносит клемму sel на позицию pos того же держателя. */
  function moveInsertTo(sel, pos) {
    const at = locateInsert(sel);
    if (!at) return;
    changeCarriers((list) => moveInsert(list, sel.carrier, sel.item, pos, carriersById, insertsById), t('carrier.moved', { name: insertLabel(at.item, at.insert) }), {
      select: (next) => findInsert(next, sel.carrier, at.item.insertId, pos),
      focus: 'insert-toolbar',
    });
  }

  /** Сдвиг клеммы кнопками или стрелками: на 5 мм (с Shift — на 0,5 мм), вплотную к соседу, если он ближе. */
  function nudgeInsert(sel, dir, fine = false) {
    const at = locateInsert(sel);
    if (!at || at.insert.fixed) return;
    const width = at.insert.widthMm;
    const max = at.catalogCarrier.lengthMm - width;
    let pos = Math.round((at.item.pos + dir * (fine ? 0.5 : 5)) / 0.5) * 0.5;
    // Упёрлась в соседа — встаёт вплотную к нему
    for (const [i, x] of at.carrier.inserts.entries()) {
      if (i === sel.item) continue;
      const w = insertsById.get(x.insertId)?.widthMm ?? 0;
      if (dir > 0 && x.pos >= at.item.pos + width - 1e-6 && pos + width > x.pos) pos = Math.min(pos, x.pos - width);
      if (dir < 0 && x.pos + w <= at.item.pos + 1e-6 && pos < x.pos + w) pos = Math.max(pos, x.pos + w);
    }
    pos = Math.max(0, Math.min(max, pos));
    if (Math.abs(pos - at.item.pos) < 1e-6) {
      update({ status: t('carrier.cantMove') });
      return;
    }
    moveInsertTo(sel, pos);
  }

  function removeInsertAt(sel) {
    const at = locateInsert(sel);
    if (!at) return;
    if (at.insert.fixed) {
      update({ status: t('carrier.fixedHint') });
      return;
    }
    changeCarriers((list) => removeInsert(list, sel.carrier, sel.item), t('carrier.insertRemoved', { name: insertLabel(at.item, at.insert) }), { select: null, focus: 'carriers-open' });
  }

  /** Переносит клемму sel в держатель to на место pos (перетаскиванием на другой держатель). */
  function transferInsertTo(sel, to, pos) {
    const at = locateInsert(sel);
    if (!at || pos === null) return render();
    const name = insertLabel(at.item, at.insert);
    changeCarriers((list) => transferInsert(list, sel.carrier, sel.item, to, pos, carriersById, insertsById), t('carrier.transferred', { name }), {
      select: (next) => findInsert(next, to, at.item.insertId, pos),
      focus: 'insert-toolbar',
    });
  }

  /** Меняет выделенную клемму на другую того же держателя (другой размер или роль). */
  function replaceInsertWith(sel, insertId) {
    const at = locateInsert(sel);
    const next = insertsById.get(insertId);
    if (!at || !next) return;
    const from = insertLabel(at.item, at.insert);
    changeCarriers(
      (list) => replaceInsert(list, sel.carrier, sel.item, insertId, carriersById, insertsById),
      t('carrier.replaced', { from, to: insertLabel({ role: at.item.role }, next) }),
      {
        // Новая клемма — на старом месте или на первом свободном: ищем её по id среди не бывших там раньше
        select: (list) => {
          const before = new Set(at.carrier.inserts.map((x, i) => (i === sel.item ? null : `${x.insertId}@${x.pos}`)));
          const item = list[sel.carrier].inserts.findIndex((x) => x.insertId === insertId && !before.has(`${x.insertId}@${x.pos}`));
          return item >= 0 ? { carrier: sel.carrier, item } : null;
        },
        focus: 'insert-toolbar',
      },
    );
  }

  /** Отпустили клемму после перетаскивания: dxMm — сдвиг вдоль держателя. */
  function dropInsert(sel, dxMm) {
    const at = locateInsert(sel);
    if (!at) return render();
    const pos = snapInsertPos(at.carrier, carriersById, insertsById, at.item.pos + dxMm, at.insert.widthMm, sel.item);
    if (pos === null || Math.abs(pos - at.item.pos) < 1e-6) return render();
    moveInsertTo(sel, pos);
  }

  /** Подсказка места клеммы при перетаскивании: зелёный — свободно, красный — занято. */
  function showInsertSlot(svg, bar, pos, width, ok) {
    svg.querySelector('.drop-slot')?.remove();
    if (!bar || pos === null) return;
    const slot = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    slot.setAttribute('class', `drop-slot ${ok ? 'ok' : 'bad'}`);
    const attrs = { x: bar.x + pos, y: bar.y - 0.8, width, height: bar.h + 1.6, rx: 1 };
    for (const [k, v] of Object.entries(attrs)) slot.setAttribute(k, String(v));
    svg.append(slot);
  }

  /** Подбор по числу линий; если держателей нет — сначала первый подходящий. */
  function fillCarriers(enc) {
    const need = clampNeed(state.board, devices);
    // Клеммники на DIN-рейку тоже считаются: если их хватает, держатель не добавляется
    const rail = railTerminals(state.board, devices);
    const counts = { n: need.N, pe: need.PE, lines: need.lines };
    let start = carrierList();
    const before = clampShortage(start, need, insertsById, rail);
    if (!before.N && !before.PE) {
      update({ status: t('carrier.autoEnough', counts) }, 'carriers-fill');
      return;
    }
    if (!start.length) {
      // Держатель, который можно заказать (или штатное место под шину)
      const options = addableCarriers(enc, carriersById);
      const first = options.find((c) => c.kind === 'carrier') ?? options.find((c) => c.kind === 'zone');
      if (!first) return;
      start = addCarrier([], first.id, carriersById);
    }
    const { carriers, short } = autoFill(start, need, carriersById, insertsById, rail);
    const status = short.N || short.PE ? t('carrier.autoShort', { n: short.N, pe: short.PE }) : t('carrier.autoDone', counts);
    update({ board: setCarriers(state.board, markFactory(carriers, enc)), status, selectedInsert: null }, 'carriers-fill');
  }

  /** Слагаемые «нужно клемм» текстом: «линий: 5, ввод: 1, УЗИП: 1». */
  const basisText = (parts) => parts.map(([key, n]) => t(key, { n })).join(', ');

  /** Есть ли среди держателей и клемм щита (и комплектации корпуса) не подтверждённые источником. */
  function carriersUnverified(enc) {
    if (enc.terminalSetup && !enc.terminalSetup.verified && carrierList().some((c) => c.included)) return true;
    return carrierList().some(
      (c) => carriersById.get(c.carrierId)?.verified === false || c.inserts.some((x) => insertsById.get(x.insertId)?.verified === false),
    );
  }

  /**
   * Клеммы N/PE в блоке проверок: сколько клемм N и PE и сколько нужно по числу линий,
   * «Подобрать по числу линий» и окно «Клеммы N/PE» (держатели, клеммы, места).
   */
  function renderCarriers(enc) {
    const options = carrierOptions(enc, carriersById);
    // Заводскую колодку и держатель без артикула отдельно не заказать: вернуть их можно кнопкой «Как с завода»
    const addable = addableCarriers(enc, carriersById);
    const factory = factoryCarriers(enc);
    const list = carrierList();
    if (!options.length && !list.length) return null;
    const have = carrierClamps(list, insertsById);
    const need = clampNeed(state.board, devices);
    // Клеммники на DIN-рейку — тоже клеммы щита
    const rail = railTerminals(state.board, devices);
    have.N += railClamps(rail, 'N');
    have.PE += railClamps(rail, 'PE');
    return h(
      'div',
      { class: 'terminals-info' },
      h('p', { class: 'muted checks-label' }, t('carrier.label')),
      h(
        'p',
        { class: 'terminals-text' },
        list.length || have.N || have.PE ? t('carrier.summary', { n: have.N, pe: have.PE }) : t('carrier.none'),
        ' ',
        h(
          'span',
          { class: 'muted' },
          t('carrier.need', { n: need.N, pe: need.PE, basis: basisText(clampBasis(need)) || t('check.part.main', { n: 1 }) }),
        ),
        need.groups.length > 0 && h('span', { class: 'muted' }, ` ${t('carrier.needBars', { bars: need.groups.length + 1, rcds: need.groups.length })}`),
        carriersUnverified(enc) && h('span', { class: 'badge', title: t('carrier.unverifiedHint') }, t('device.unverified')),
      ),
      h(
        'div',
        { class: 'action-buttons' },
        h('button', { type: 'button', class: 'action', dataset: { focus: 'carriers-fill' }, onClick: () => fillCarriers(enc) }, t('carrier.fill')),
        h(
          'button',
          { type: 'button', class: 'action', 'aria-haspopup': 'dialog', dataset: { focus: 'carriers-open' }, onClick: () => update({ carriersOpen: true, status: '' }) },
          t('carrier.open'),
        ),
      ),
      state.carriersOpen &&
        moreDialog({
          titleId: 'h-carriers',
          title: t('carrier.dialogTitle'),
          stateKey: 'carriersOpen',
          focusKey: 'carriers-open',
          content: [
            h('p', { class: 'status dialog-status', role: 'status', 'aria-live': 'polite' }, state.status),
            h('p', { class: 'hint' }, t('carrier.dialogHint')),
            list.map((c, index) => renderCarrierBlock(enc, c, index, addable)),
            factory.length > 0 &&
              JSON.stringify(factory) !== JSON.stringify(list) &&
              h(
                'p',
                {},
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'action',
                    dataset: { focus: 'carriers-factory' },
                    onClick: () => changeCarriers(() => factory, t('carrier.factorySet'), { select: null, focus: 'carriers-open' }),
                  },
                  t('carrier.factory'),
                ),
              ),
            h('h3', { class: 'comb-parts-title' }, t('carrier.addTitle')),
            h(
              'ul',
              { class: 'device-list' },
              addable.map((o) =>
                h(
                  'li',
                  { class: 'device-row' },
                  h(
                    'span',
                    { class: 'device-text' },
                    h('strong', {}, carrierName(o, t)),
                    h('span', { class: 'muted' }, o.article ?? t('carrier.noArticle'), !o.verified && h('span', { class: 'badge', title: t('device.unverifiedHint') }, t('device.unverified'))),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'action',
                      disabled: list.length >= LIMITS.carriers,
                      dataset: { focus: `carrier-add-${o.id}` },
                      onClick: () => changeCarriers((l) => addCarrier(l, o.id, carriersById), t('carrier.added', { name: carrierName(o, t) })),
                    },
                    t('carrier.add'),
                  ),
                ),
              ),
            ),
          ],
        }),
    );
  }

  /** Один держатель в окне «Клеммы N/PE»: место, клеммы (роль, убрать), добавить клемму, заменить или убрать держатель. */
  function renderCarrierBlock(enc, c, index, options) {
    const carrier = carriersById.get(c.carrierId);
    if (!carrier) return null;
    const name = carrierName(carrier, t);
    const free = (insert) => firstFreeInsertPos(c, carriersById, insertsById, insert.widthMm) !== null;
    const adds = insertOptions(c.carrierId, insertsById).sort(
      (a, b) => INSERT_ROLE_ORDER.indexOf(a.role) - INSERT_ROLE_ORDER.indexOf(b.role) || a.widthMm - b.widthMm,
    );
    const positionLabel = `${t('carrier.position')} ${index + 1}`;
    return h(
      'section',
      { class: 'carrier-block', 'aria-label': `${index + 1}. ${name}` },
      h(
        'h3',
        { class: 'comb-parts-title' },
        `${index + 1}. ${name}${carrier.article ? ` · ${carrier.article}` : ''}`,
        !carrier.verified && h('span', { class: 'badge', title: t('device.unverifiedHint') }, t('device.unverified')),
      ),
      h('p', { class: 'muted' }, carrier.kind === 'zone' ? t('carrier.zoneHint') : c.included ? t('carrier.included') : t('carrier.toOrder')),
      carrier.positions.length > 1
        ? chips(
            positionLabel,
            c.position,
            carrier.positions.map((p) => [p, t(`carrier.pos.${p}`)]),
            (p) => changeCarriers((l) => setCarrierPosition(l, index, p, carriersById), t('carrier.positionSet', { name, place: t(`carrier.pos.${p}`) })),
          )
        : h('p', { class: 'muted' }, t('carrier.onlyAt', { place: t(`carrier.pos.${carrier.positions[0]}`) })),
      c.inserts.length
        ? h(
            'ul',
            { class: 'device-list' },
            c.inserts.map((item, i) => {
              const insert = insertsById.get(item.insertId);
              if (!insert) return null;
              const label = insertLabel(item, insert);
              return h(
                'li',
                { class: 'device-row' },
                h(
                  'span',
                  { class: 'device-text' },
                  h('strong', {}, insertName(insert, roleOf(item, insert), t)),
                  h(
                    'span',
                    { class: 'muted' },
                    [insert.article, t('carrier.width', { mm: fmt(insert.widthMm) }), item.included ? t('carrier.specIncluded') : null].filter(Boolean).join(' · '),
                    !insert.verified && h('span', { class: 'badge', title: t('device.unverifiedHint') }, t('device.unverified')),
                  ),
                ),
                insert.role === 'universal' &&
                  chips(`${t('carrier.cover')} ${index + 1}-${i + 1}`, roleOf(item, insert), [['N', 'N'], ['PE', 'PE']], (role) =>
                    changeCarriers((l) => setInsertRole(l, index, i, role), t('carrier.roleSet', { name: label, role })),
                  ),
                insert.fixed
                  ? h('span', { class: 'muted' }, t('carrier.fixed'))
                  : h(
                      'button',
                      {
                        type: 'button',
                        class: 'tool',
                        'aria-label': t('carrier.removeInsert', { name: label }),
                        title: t('carrier.removeInsert', { name: label }),
                        dataset: { focus: `insert-remove-${index}-${i}` },
                        onClick: () => changeCarriers((l) => removeInsert(l, index, i), t('carrier.insertRemoved', { name: label }), { select: null, focus: `carrier-block-${index}` }),
                      },
                      '✕',
                    ),
              );
            }),
          )
        : h('p', { class: 'muted' }, t('carrier.empty')),
      adds.length > 0 && h('h4', { class: 'carrier-sub' }, t('carrier.addInsert')),
      adds.length > 0 &&
        h(
          'ul',
          { class: 'device-list' },
          adds.map((insert) => {
            const role = insert.role === 'universal' ? 'N' : insert.role;
            const nameText = insertName(insert, insert.role === 'universal' ? t('carrier.anyRole') : role, t);
            const fits = free(insert);
            return h(
              'li',
              { class: 'device-row' },
              h(
                'span',
                { class: 'device-text' },
                h('strong', {}, nameText),
                h(
                  'span',
                  { class: 'muted' },
                  [insert.article, t('carrier.width', { mm: fmt(insert.widthMm) })].filter(Boolean).join(' · '),
                  !insert.verified && h('span', { class: 'badge', title: t('device.unverifiedHint') }, t('device.unverified')),
                ),
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'action',
                  disabled: !fits,
                  title: fits ? undefined : t('carrier.error.too-wide'),
                  'aria-label': t('carrier.addInsertTitle', { name: `${nameText}${insert.article ? ` (${insert.article})` : ''}` }),
                  dataset: { focus: `insert-add-${index}-${insert.id}` },
                  onClick: () => changeCarriers((l) => addInsert(l, index, insert.id, carriersById, insertsById), t('carrier.insertAdded', { name: nameText })),
                },
                fits ? t('carrier.add') : t('carrier.noRoom'),
              ),
            );
          }),
        ),
      h(
        'div',
        { class: 'action-buttons', dataset: { focus: `carrier-block-${index}` }, tabindex: '-1' },
        options
          .filter((o) => o.id !== c.carrierId)
          .map((o) =>
            h(
              'button',
              {
                type: 'button',
                class: 'action',
                dataset: { focus: `carrier-swap-${index}-${o.id}` },
                onClick: () =>
                  changeCarriers((l) => swapCarrier(l, index, o.id, carriersById, insertsById), t('carrier.swapped', { from: name, to: carrierName(o, t) }), { select: null }),
              },
              t('carrier.swap', { name: carrierName(o, t) }),
            ),
          ),
        h(
          'button',
          {
            type: 'button',
            class: 'action',
            dataset: { focus: `carrier-remove-${index}` },
            onClick: () => changeCarriers((l) => removeCarrier(l, index), t('carrier.removed', { name }), { select: null, focus: 'carriers-open' }),
          },
          carrier.kind === 'zone' ? t('carrier.removeZone') : t('carrier.remove'),
        ),
      ),
    );
  }

  /** Панель выделенной клеммы: сдвиг ← →, роль по крышке (у универсальной), убрать. */
  function renderInsertToolbar() {
    const at = locateInsert();
    if (!at) return null;
    const { sel, item, insert, carrier, catalogCarrier } = at;
    const label = insertLabel(item, insert);
    const tool = (key, text, disabled, action) =>
      h('button', { type: 'button', class: 'tool', 'aria-label': t(key), title: t(key), disabled, dataset: { focus: `insert-${key}` }, onClick: action }, text);
    // Держатель вверх или вниз — вместе со всеми клеммами (если такое место у него есть)
    const place = (position) =>
      changeCarriers((l) => setCarrierPosition(l, sel.carrier, position, carriersById), t('carrier.positionSet', { name: carrierName(catalogCarrier, t), place: t(`carrier.pos.${position}`) }), {
        focus: 'insert-toolbar',
      });
    const canPlace = (position) => carrier.position !== position && catalogCarrier.positions.includes(position);
    // Замена на другую клемму того же держателя (размер или роль)
    const others = insertOptions(carrier.carrierId, insertsById)
      .filter((x) => x.id !== insert.id)
      .sort((a, b) => INSERT_ROLE_ORDER.indexOf(a.role) - INSERT_ROLE_ORDER.indexOf(b.role) || a.widthMm - b.widthMm);
    const replace =
      !insert.fixed &&
      others.length > 0 &&
      h(
        'label',
        { class: 'toolbar-select' },
        h('span', { class: 'muted' }, t('carrier.replace')),
        h(
          'select',
          { dataset: { focus: 'insert-replace' }, onChange: (event) => event.target.value && replaceInsertWith(sel, event.target.value) },
          h('option', { value: '' }, '—'),
          others.map((x) => h('option', { value: x.id }, `${x.article ? `${x.article} — ` : ''}${insertName(x, x.role === 'universal' ? t('carrier.anyRole') : x.role, t)}, ${t('carrier.width', { mm: fmt(x.widthMm) })}`)),
        ),
      );
    return h(
      'div',
      { class: 'toolbar', role: 'toolbar', 'aria-label': t('item.selected', { title: label }), dataset: { focus: 'insert-toolbar' }, tabindex: '-1' },
      h('span', { class: 'toolbar-title' }, t('item.selected', { title: label })),
      insert.fixed && h('span', { class: 'muted' }, t('carrier.fixedHint')),
      h(
        'span',
        { class: 'toolbar-buttons' },
        insert.role === 'universal' &&
          chips(t('carrier.cover'), roleOf(item, insert), [['N', 'N'], ['PE', 'PE']], (role) =>
            changeCarriers((l) => setInsertRole(l, sel.carrier, sel.item, role), t('carrier.roleSet', { name: label, role })),
          ),
        tool('carrier.moveLeft', '←', insert.fixed, () => nudgeInsert(sel, -1)),
        tool('carrier.moveRight', '→', insert.fixed, () => nudgeInsert(sel, 1)),
        tool('carrier.toTop', '↑', !canPlace('top'), () => place('top')),
        tool('carrier.toBottom', '↓', !canPlace('bottom'), () => place('bottom')),
        tool('item.remove', '✕', insert.fixed, () => removeInsertAt(sel)),
      ),
      replace,
    );
  }

  /** Кнопки проекта: ссылка, файл, открыть файл; «Очистить щит». */
  function renderProjectActions(hasBoard) {
    const button = (key, focus, action) =>
      h('button', { type: 'button', class: 'action', dataset: { focus }, onClick: action }, t(key));
    return h(
      'div',
      { class: 'project-actions' },
      h(
        'div',
        { class: 'action-buttons', role: 'group', 'aria-label': t('project.actions') },
        hasBoard && button('project.link', 'project-link', copyLink),
        hasBoard && button('project.download', 'project-download', downloadFile),
        button('project.open', 'project-open', openFile),
        backupText !== null && button('project.downloadBackup', 'project-backup', downloadBackup),
        backupText !== null && button('project.deleteBackup', 'project-backup-delete', deleteBackup),
      ),
      hasBoard && h('p', { class: 'muted' }, store ? t('project.autosaveHint') : t('project.autosaveOff')),
      hasBoard &&
        h(
          'div',
          { class: 'reset-buttons' },
          h('button', { type: 'button', class: 'link-button', dataset: { focus: 'clear' }, onClick: clearBoard }, t('board.clear')),
          h('button', { type: 'button', class: 'link-button', dataset: { focus: 'reset' }, onClick: startOver }, t('board.reset')),
        ),
    );
  }

  function renderBoard() {
    const enc = enclosure();
    const heading = h('h2', { id: 'h-board' }, t('section.board'));
    const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' }, state.status);
    if (!enc) {
      return h(
        'section',
        { class: 'panel board-panel', 'aria-labelledby': 'h-board' },
        heading,
        h('p', { class: 'hint' }, t('enclosure.choose')),
        status,
        renderProjectActions(false),
      );
    }
    const stats = boardStats(state.board, enc, devices);
    return h(
      'section',
      { class: 'panel board-panel', 'aria-labelledby': 'h-board' },
      // Только на бумаге: что за корпус (панель выбора корпуса не печатается), дата и ссылка на щит
      h(
        'div',
        { class: 'print-only print-head' },
        // Артикул в скобках — только если в названии тип, а не сам артикул
        h('p', { class: 'print-title' }, `${brandNames.get(enc.brand)} ${enclosureTitle(enc)}${enc.model ? ` (${enc.article})` : ''}`),
        h('p', {}, `${enclosureDescription(enc, t)} · ${enclosureSize(enc, t)}`),
        h('p', {}, t('print.date', { date: new Date().toLocaleDateString(t.lang) })),
        h('p', { class: 'print-link' }, `${t('print.link')} ${boardUrl()}`),
      ),
      h('div', { class: 'panel-head' }, heading, h('span', { class: 'muted' }, t('board.total', { used: fmt(stats.used), capacity: stats.capacity, free: fmt(stats.free) }))),
      h('p', { class: 'hint' }, t('board.activeRowHint')),
      h(
        'div',
        { class: 'row-chips', role: 'group', 'aria-label': t('board.rows') },
        state.board.rows.map((_, rowIndex) =>
          h(
            'button',
            {
              type: 'button',
              class: 'chip row-chip',
              'aria-pressed': String(rowIndex === state.activeRow),
              'aria-label': `${t('board.selectRow', { n: rowIndex + 1 })}: ${t('board.rowUsage', { used: fmt(stats.rows[rowIndex].used), capacity: stats.rows[rowIndex].capacity })}`,
              dataset: { focus: `row-${rowIndex}` },
              onClick: () => update({ activeRow: rowIndex }),
            },
            h('strong', {}, t('board.row', { n: rowIndex + 1 })),
            ' · ',
            t('board.rowUsage', { used: fmt(stats.rows[rowIndex].used), capacity: stats.rows[rowIndex].capacity }),
          ),
        ),
      ),
      renderRowComb(enc),
      renderBoardView(enc),
      renderToolbar(),
      renderInsertToolbar(),
      status,
      renderChecks(enc),
      renderProjectActions(true),
    );
  }

  function renderPalette() {
    const brandFilter = state.deviceBrand ?? enclosure()?.brand ?? 'all';
    const ofBrand = catalog.devices.filter((d) => brandFilter === 'all' || d.brand === brandFilter);
    const inCategory = ofBrand.filter((d) => d.category === state.category);
    const poles = POLE_ORDER.filter((p) => inCategory.some((d) => d.specs.poles === p));
    const list = inCategory.filter((d) => state.poles === 'all' || d.specs.poles === state.poles).sort(compareDevices);
    const { shown, rest } = previewSplit(list, PREVIEW_COUNT);
    const canAdd = Boolean(state.board);
    // Строка устройства; в окне «Ещё варианты» — без перетаскивания (щит за окном недоступен), только «+»
    const deviceRow = (d, draggable) => {
      const title = deviceTitle(d, t);
      return h(
        'li',
        { class: 'device-row', draggable: draggable && canAdd ? 'true' : null, onDragstart: draggable && canAdd ? dragStart({ deviceId: d.id }) : null },
        h('span', { class: `swatch cat-${d.category}`, style: { width: `${d.modules * 10}px` }, 'aria-hidden': 'true' }),
        h(
          'span',
          { class: 'device-text' },
          h('strong', {}, title),
          h(
            'span',
            { class: 'muted' },
            `${deviceRef(d, brandNames.get(d.brand))} · ${d.article} · ${t('device.modules', { n: fmt(d.modules) })}`,
            !d.verified && h('span', { class: 'badge', title: t('device.unverifiedHint') }, t('device.unverified')),
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'add',
            disabled: !canAdd,
            'aria-label': t('device.add', { title }),
            title: t('device.add', { title }),
            dataset: { focus: `add-${d.id}` },
            onClick: () => add(d.id),
          },
          '+',
        ),
      );
    };
    return h(
      'section',
      { class: 'panel palette', 'aria-labelledby': 'h-devices' },
      h('h2', { id: 'h-devices' }, t('section.devices')),
      catalog.brands.length > 1 &&
        chips(
          t('filter.brand'),
          brandFilter,
          [['all', t('filter.all')], ...catalog.brands.map((b) => [b.id, b.name])],
          (deviceBrand) => update({ deviceBrand, poles: 'all' }),
        ),
      chips(
        t('filter.category'),
        state.category,
        CATEGORY_ORDER.filter((c) => ofBrand.some((d) => d.category === c)).map((c) => [c, categoryName(c, t)]),
        (category) => update({ category, poles: 'all' }),
      ),
      poles.length > 1 && chips(t('filter.poles'), state.poles, [['all', t('filter.all')], ...poles.map((p) => [p, p])], (p) => update({ poles: p })),
      h('ul', { class: 'device-list' }, shown.map((d) => deviceRow(d, true))),
      rest.length > 0 &&
        h(
          'div',
          { class: 'picker-actions' },
          h(
            'button',
            { type: 'button', class: 'action', 'aria-haspopup': 'dialog', dataset: { focus: 'dev-more' }, onClick: () => update({ devicesMoreOpen: true, status: '' }) },
            t('devices.more', { n: rest.length }),
          ),
        ),
      rest.length > 0 &&
        state.devicesMoreOpen &&
        moreDialog({
          titleId: 'h-devices-more',
          title: t('devices.moreTitle', { n: rest.length }),
          stateKey: 'devicesMoreOpen',
          focusKey: 'dev-more',
          // Окно не закрывается после «+»: можно добавить несколько устройств подряд; ответ — строкой в окне
          content: [
            h('p', { class: 'status dialog-status', role: 'status', 'aria-live': 'polite' }, state.status),
            h('ul', { class: 'device-list' }, rest.map((d) => deviceRow(d, false))),
          ],
        }),
    );
  }

  function renderSummary() {
    const enc = enclosure();
    const head = h('h2', { id: 'h-summary' }, t('section.summary'));
    if (!enc) return h('section', { class: 'panel summary', 'aria-labelledby': 'h-summary' }, head, h('p', { class: 'hint' }, t('summary.empty')));
    const enclosureName = t('summary.enclosure', { title: `${brandNames.get(enc.brand)} ${enclosureTitle(enc)} (${enclosureDescription(enc, t)})` });
    const rows = [
      [enc.article, enclosureName, 1, !enc.verified && t('enclosure.unverifiedHint')],
      // Держатели и клеммы N/PE — своими артикулами; стоящие с завода — с пометкой «в комплекте корпуса»
      ...carriersSpec(state.board, carriersById, insertsById, t).map((line) => [
        line.article || '—',
        `${line.name} — ${brandNames.get(line.brand)}${line.included ? ` (${t('carrier.specIncluded')})` : ''}`,
        line.count,
        !line.verified && t('device.unverifiedHint'),
      ]),
      ...billOfMaterials(state.board).map(({ deviceId, count }) => {
        const d = devices.get(deviceId);
        return [d.article, `${deviceTitle(d, t)} — ${deviceRef(d, brandNames.get(d.brand))}`, count, !d.verified && t('device.unverifiedHint')];
      }),
      ...combsSpec(state.board, combsById).map(({ comb, count }) => [
        comb.article,
        `${combName(comb, t)} — ${brandNames.get(comb.brand)}`,
        count,
        !comb.verified && t('device.unverifiedHint'),
      ]),
      ...combPartsSpec(state.board, partsById).map(({ part, count }) => [
        part.article,
        `${combPartName(part, t)} — ${brandNames.get(part.brand)}`,
        count,
        !part.verified && t('device.unverifiedHint'),
      ]),
    ];
    return h(
      'section',
      { class: 'panel summary', 'aria-labelledby': 'h-summary' },
      head,
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('summary.article')), h('th', { scope: 'col' }, t('summary.name')), h('th', { scope: 'col', class: 'num' }, t('summary.qty')))),
        h(
          'tbody',
          {},
          // Непроверенная позиция — пометка с пояснением прямо в строке (видна и при печати)
          rows.map(([article, name, qty, unverified]) =>
            h(
              'tr',
              {},
              h('td', { class: 'mono' }, article),
              h('td', {}, name, unverified && h('span', { class: 'badge', title: unverified }, t('device.unverified')), unverified && h('span', { class: 'unverified-note' }, unverified)),
              h('td', { class: 'num' }, qty),
            ),
          ),
        ),
      ),
      renderExportActions(),
    );
  }

  /** Выгрузка состава: печать / PDF, CSV, Excel. */
  function renderExportActions() {
    const button = (key, focus, action) =>
      h('button', { type: 'button', class: 'action', dataset: { focus }, onClick: action }, t(key));
    return h(
      'div',
      { class: 'export-actions' },
      h('h3', { id: 'h-export' }, t('export.actions')),
      h(
        'div',
        { class: 'action-buttons', role: 'group', 'aria-labelledby': 'h-export' },
        button('export.print', 'export-print', printBoard),
        button('export.csv', 'export-csv', downloadCsv),
        button('export.xlsx', 'export-xlsx', downloadXlsx),
      ),
      h('p', { class: 'muted' }, t('export.printHint')),
    );
  }

  function render(focusFallback) {
    const focusKey = document.activeElement?.dataset?.focus;
    root.replaceChildren(
      // Порядок в разметке = порядок чтения и Tab: корпус, щит, оборудование, состав.
      // На широком экране CSS раскладывает панели в две колонки.
      h('div', { class: 'layout' }, renderEnclosurePicker(), renderBoard(), renderPalette(), renderSummary()),
    );
    root.querySelector('dialog.more-dialog')?.showModal();
    // Фокус возвращаем, только если он был внутри конструктора
    if (focusKey) {
      const find = (key) => (key ? root.querySelector(`[data-focus="${CSS.escape(key)}"]`) : null);
      let target = find(focusKey);
      if (!target || target.disabled) target = find(focusFallback);
      target?.focus();
    }
  }

  /** Переключение языка: новый переводчик, перерисовка; щит и выбор сохраняются. */
  function setTranslator(next) {
    t = next;
    update({ status: '' });
  }

  autosave();
  render();
  // Печать из меню браузера или по Ctrl+P идёт мимо кнопки: перед ней тоже перерисовываем,
  // иначе в шапке останется дата последней перерисовки (вкладка могла быть открыта со вчера)
  window.addEventListener('beforeprint', () => render());
  /** Сообщение в строке статуса (для действий вне конструктора, например выбора языка). */
  function setStatus(text) {
    update({ status: text });
  }

  return { state, render, setTranslator, setStatus };
}
