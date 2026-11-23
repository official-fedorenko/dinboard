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
  nearestFreePos,
  snapPos,
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
import { layoutBoard, hitTest, renderBoardSvg, MODULE_MM } from './render-svg.js';
import { checkBoard } from './checks.js';
import { specTable, toCsv, exportFileName } from './export.js';
import { xlsxWorkbook } from './xlsx.js';
import { filterEnclosures, availableValues, previewSplit, PREVIEW_COUNT } from './enclosure-filter.js';
import { EARTHING_SYSTEMS } from './catalog.js';
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

export const CATEGORY_ORDER = ['mcb', 'rcbo', 'rcd', 'switch', 'spd'];
const POLE_ORDER = ['1P', '1P+N', '2P', '3P', '3P+N', '4P'];
const DND_TYPE = 'application/x-dinboard';

/** Порядок устройств в списке: серия, полюса, кривая/тип, номинал. */
function compareDevices(a, b) {
  const sa = a.specs;
  const sb = b.specs;
  return (
    a.series.localeCompare(b.series) ||
    POLE_ORDER.indexOf(sa.poles) - POLE_ORDER.indexOf(sb.poles) ||
    String(sa.curve ?? sa.rcdType ?? sa.spdType).localeCompare(String(sb.curve ?? sb.rcdType ?? sb.spdType)) ||
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

  const spec = () => specTable(state.board, enclosure(), devices, brandNames, t);
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
        const { board, skipped } = buildBoard(project, enclosures, devices);
        const current = state.board ? projectFromBoard(state.board) : null;
        if (!isEmptyProject(current) && !sameProject(current, projectFromBoard(board)) && !window.confirm(t('project.confirmReplace'))) {
          return;
        }
        update({
          board,
          selectedUid: null,
          activeRow: 0,
          pickerOpen: false,
          status: skipped.length ? t('project.loadedSkipped', { n: skipped.length }) : t('project.loaded'),
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
      update({ board: createBoard(next), activeRow: 0, selectedUid: null, status: '', pickerOpen: false, moreOpen: false });
      return;
    }
    if (state.board.enclosureId === id) {
      update({ pickerOpen: false, moreOpen: false });
      return;
    }
    const { board, overflow } = changeEnclosure(state.board, next, devices);
    if (overflow.length && !window.confirm(t('enclosure.confirmOverflow', { n: overflow.length }))) return;
    update({
      board,
      pickerOpen: false,
      moreOpen: false,
      activeRow: Math.min(state.activeRow, board.rows.length - 1),
      selectedUid: findItem(board, state.selectedUid) ? state.selectedUid : null,
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
    // Система заземления — свойство объекта, а не набора устройств: при очистке сохраняется
    const board = setEarthing(createBoard(enclosure()), state.board.earthing);
    update({ board, selectedUid: null, activeRow: 0, status: t('board.cleared') });
  }

  // ---------- перетаскивание ----------
  // Из списка оборудования в щит — HTML5 Drag and Drop (мышь).
  // Внутри щита — Pointer Events: работает и мышью, и пальцем.

  const dragStart = (payload) => (event) => {
    event.dataTransfer.setData(DND_TYPE, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'copy';
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

  function bindBoardEvents(view, svg, layout) {
    let drag = null;
    let suppressClick = false;

    view.addEventListener('pointerdown', (event) => {
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
      drag.dev.setAttribute('transform', `${drag.base} translate(${dx * scale} ${dy * scale})`);
      const p = toBoardPoint(svg, event.clientX, event.clientY);
      if (p) markDropRow(svg, hitTest(layout, p.x, p.y)?.row);
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
      dropExisting(current.uid, p ? hitTest(layout, p.x, p.y) : null, (event.clientX - current.x) * scale);
    };
    view.addEventListener('pointerup', (event) => finish(event, false));
    view.addEventListener('pointercancel', (event) => finish(event, true));

    view.addEventListener('click', (event) => {
      if (suppressClick) return;
      const dev = event.target.closest?.('.dev');
      if (dev) {
        const uid = Number(dev.dataset.uid);
        const at = findItem(state.board, uid);
        if (at) update({ selectedUid: state.selectedUid === uid ? null : uid, activeRow: at.row });
        return;
      }
      const rowEl = event.target.closest?.('[data-row]');
      if (rowEl) update({ activeRow: Number(rowEl.dataset.row), selectedUid: null });
    });

    view.addEventListener('keydown', (event) => {
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
      if (p) markDropRow(svg, hitTest(layout, p.x, p.y)?.row);
    });
    view.addEventListener('dragleave', (event) => {
      if (!view.contains(event.relatedTarget)) markDropRow(svg, null);
    });
    view.addEventListener('drop', (event) => {
      const raw = event.dataTransfer.getData(DND_TYPE);
      if (!raw) return;
      event.preventDefault();
      markDropRow(svg, null);
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
          { type: 'button', class: 'link-button', 'aria-expanded': 'false', dataset: { focus: 'picker-toggle' }, onClick: () => update({ pickerOpen: true }) },
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
      rest.length > 0 &&
        h(
          'button',
          { type: 'button', class: 'action more-button', 'aria-haspopup': 'dialog', dataset: { focus: 'enc-more' }, onClick: () => update({ moreOpen: true }) },
          t('enclosure.more', { n: rest.length }),
        ),
      rest.length > 0 && state.moreOpen && renderMoreDialog(rest),
      current &&
        h(
          'button',
          { type: 'button', class: 'link-button', 'aria-expanded': 'true', dataset: { focus: 'picker-toggle' }, onClick: () => update({ pickerOpen: false }) },
          t('enclosure.keep'),
        ),
    );
  }

  /**
   * Окно «Ещё варианты»: остальные подходящие корпуса. Встроенный <dialog> (showModal — в render):
   * Esc и ✕ закрывают, Tab не выходит из окна, щелчок мимо окна (по подложке) тоже закрывает.
   */
  function renderMoreDialog(rest) {
    const dialog = h(
      'dialog',
      { class: 'enclosure-dialog', 'aria-labelledby': 'h-enclosure-more' },
      h(
        'div',
        { class: 'dialog-body' },
        h(
          'div',
          { class: 'dialog-head' },
          h('h2', { id: 'h-enclosure-more' }, t('enclosure.moreTitle', { n: rest.length })),
          h(
            'button',
            { type: 'button', class: 'tool dialog-close', 'aria-label': t('dialog.close'), title: t('dialog.close'), dataset: { focus: 'enc-more-close' }, onClick: () => dialog.close() },
            '✕',
          ),
        ),
        h('ul', { class: 'enclosure-list' }, rest.map((e) => h('li', {}, enclosureCard(e)))),
      ),
    );
    // Щелчок по подложке приходит на сам <dialog>. Но и щелчок по пустому месту внутри окна
    // (на телефоне окно во весь экран, а список короче) — тоже, поэтому закрываем,
    // только если точка вне прямоугольника окна.
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      const inside = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
      if (!inside) dialog.close();
    });
    // Закрытие (Esc, ✕, подложка). Окно, убранное перерисовкой, не трогает состояние.
    // После закрытия фокус — на кнопку «Ещё варианты» (прежний фокус браузер вернуть не может: кнопку перерисовали).
    dialog.addEventListener('close', () => {
      if (!dialog.isConnected || !state.moreOpen) return;
      update({ moreOpen: false });
      root.querySelector('[data-focus="enc-more"]')?.focus();
    });
    return dialog;
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
    const svg = svgNode(
      renderBoardSvg(layout, devices, {
        t,
        deviceTitle,
        deviceLabel,
        title: `${brandNames.get(enc.brand)} ${enclosureTitle(enc)}`,
        selectedUid: state.selectedUid,
        activeRow: state.activeRow,
        formatNumber: fmt,
      }),
    );
    const view = h('div', { class: `board-view${state.selectedUid !== null ? ' has-selection' : ''}` }, svg);
    bindBoardEvents(view, svg, layout);
    return view;
  }

  /** Проверки щита: система заземления и подсказки (не мешают сборке). */
  function renderChecks(enc) {
    const list = checkBoard(state.board, enc, devices);
    const items = list.map((check) => {
      const params = { ...check.params };
      if (typeof params.free === 'number') params.free = fmt(params.free);
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
      items.length ? h('ul', { class: 'check-list' }, items) : h('p', { class: 'check-ok' }, t('check.ok')),
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
      hasBoard && h('button', { type: 'button', class: 'link-button', dataset: { focus: 'clear' }, onClick: clearBoard }, t('board.clear')),
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
      renderBoardView(enc),
      renderToolbar(),
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
    const canAdd = Boolean(state.board);
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
      h(
        'ul',
        { class: 'device-list' },
        list.map((d) => {
          const title = deviceTitle(d, t);
          return h(
            'li',
            { class: 'device-row', draggable: canAdd ? 'true' : null, onDragstart: canAdd ? dragStart({ deviceId: d.id }) : null },
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
        }),
      ),
    );
  }

  function renderSummary() {
    const enc = enclosure();
    const head = h('h2', { id: 'h-summary' }, t('section.summary'));
    if (!enc) return h('section', { class: 'panel summary', 'aria-labelledby': 'h-summary' }, head, h('p', { class: 'hint' }, t('summary.empty')));
    const rows = [
      [enc.article, t('summary.enclosure', { title: `${brandNames.get(enc.brand)} ${enclosureTitle(enc)} (${enclosureDescription(enc, t)})` }), 1, !enc.verified && t('enclosure.unverifiedHint')],
      ...billOfMaterials(state.board).map(({ deviceId, count }) => {
        const d = devices.get(deviceId);
        return [d.article, `${deviceTitle(d, t)} — ${deviceRef(d, brandNames.get(d.brand))}`, count, !d.verified && t('device.unverifiedHint')];
      }),
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
    root.querySelector('dialog.enclosure-dialog')?.showModal();
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
