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
  BoardError,
} from './board.js';
import {
  deviceLabel,
  deviceTitle,
  categoryName,
  enclosureTitle,
  enclosureDescription,
  enclosureSize,
  num,
} from './format.js';
import { h } from './dom.js';

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

export function mountApp(root, { catalog, t }) {
  const devices = indexById(catalog.devices);
  const enclosures = indexById(catalog.enclosures);
  const brandNames = new Map(catalog.brands.map((b) => [b.id, b.name]));

  const state = {
    board: null,
    activeRow: 0,
    selectedUid: null,
    brand: 'all',
    mounting: 'all',
    category: CATEGORY_ORDER.find((c) => catalog.devices.some((d) => d.category === c)) ?? CATEGORY_ORDER[0],
    poles: 'all',
    status: '',
    pickerOpen: true, // список корпусов развёрнут; после выбора сворачивается до выбранного
  };

  const enclosure = () => (state.board ? enclosures.get(state.board.enclosureId) : null);

  // ---------- действия ----------

  /**
   * Меняет состояние и перерисовывает. focusFallback — куда перевести фокус,
   * если элемент, на котором он был, исчез или стал недоступен (например,
   * кнопка «←» на крайней позиции или удалённое устройство).
   */
  function update(changes, focusFallback) {
    Object.assign(state, changes);
    render(focusFallback);
  }

  function reportError(err, title) {
    if (!(err instanceof BoardError)) throw err;
    if (err.code === 'no-space') {
      return err.details.row === undefined
        ? t('status.noSpaceAny', { title })
        : t('status.noSpace', { row: err.details.row + 1 });
    }
    return t('status.error');
  }

  function selectEnclosure(id) {
    const next = enclosures.get(id);
    if (!state.board) {
      update({ board: createBoard(next), activeRow: 0, selectedUid: null, status: '', pickerOpen: false });
      return;
    }
    if (state.board.enclosureId === id) {
      update({ pickerOpen: false });
      return;
    }
    const { board, overflow } = changeEnclosure(state.board, next, devices);
    if (overflow.length && !window.confirm(t('enclosure.confirmOverflow', { n: overflow.length }))) return;
    update({
      board,
      pickerOpen: false,
      activeRow: Math.min(state.activeRow, board.rows.length - 1),
      selectedUid: findItem(board, state.selectedUid) ? state.selectedUid : null,
      status: overflow.length
        ? t('enclosure.overflowRemoved', { n: overflow.length })
        : t('enclosure.changed', { title: enclosureTitle(next) }),
    });
  }

  function add(deviceId, row = state.activeRow, index) {
    const title = deviceTitle(devices.get(deviceId), t);
    try {
      const result = addDevice(state.board, enclosure(), devices, deviceId, { row, index });
      update({ board: result.board, selectedUid: result.uid, status: t('status.added', { title }) });
    } catch (err) {
      // Выбранный ряд заполнен — пробуем любой ряд с местом
      if (err instanceof BoardError && err.code === 'no-space' && index === undefined) {
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

  function move(uid, toRow, toIndex) {
    const item = findItem(state.board, uid);
    if (!item) return;
    const title = deviceTitle(devices.get(state.board.rows[item.row][item.index].deviceId), t);
    try {
      const board = moveItem(state.board, enclosure(), devices, uid, toRow, toIndex);
      const to = findItem(board, uid);
      update(
        { board, selectedUid: uid, activeRow: to.row, status: t('status.moved', { title, row: to.row + 1, place: to.index + 1 }) },
        `item-${uid}`,
      );
    } catch (err) {
      update({ status: reportError(err, title) });
    }
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
    update({ board: createBoard(enclosure()), selectedUid: null, activeRow: 0, status: t('board.cleared') });
  }

  // ---------- перетаскивание ----------

  function dropIndex(rail, clientX) {
    const items = [...rail.querySelectorAll('.item')];
    const index = items.findIndex((el) => {
      const box = el.getBoundingClientRect();
      return clientX < box.left + box.width / 2;
    });
    return index === -1 ? items.length : index;
  }

  function onDrop(event, row) {
    const raw = event.dataTransfer.getData(DND_TYPE);
    if (!raw) return;
    event.preventDefault();
    event.currentTarget.classList.remove('drop-target');
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    let index = dropIndex(event.currentTarget, event.clientX);
    if (typeof data.uid === 'number') {
      const from = findItem(state.board, data.uid);
      if (!from) return;
      // Индекс посчитан вместе с перетаскиваемым устройством — поправка для того же ряда
      if (from.row === row && index > from.index) index -= 1;
      move(data.uid, row, index);
    } else if (typeof data.deviceId === 'string' && devices.has(data.deviceId)) {
      add(data.deviceId, row, index);
    }
  }

  const dragStart = (payload) => (event) => {
    event.dataTransfer.setData(DND_TYPE, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'move';
  };

  // ---------- отрисовка ----------

  function chips(label, value, options, onPick) {
    return h(
      'div',
      { class: 'chips', role: 'group', 'aria-label': label },
      options.map(([key, text]) =>
        h('button', { type: 'button', class: 'chip', 'aria-pressed': String(value === key), dataset: { focus: `chip-${label}-${key}` }, onClick: () => onPick(key) }, text),
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
        h('span', { class: 'muted' }, enclosureSize(e, t)),
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
    const list = catalog.enclosures.filter(
      (e) => (state.brand === 'all' || e.brand === state.brand) && (state.mounting === 'all' || e.mounting === state.mounting),
    );
    return h(
      'section',
      { class: 'panel picker', 'aria-labelledby': 'h-enclosure' },
      heading,
      catalog.brands.length > 1 &&
        chips(t('filter.brand'), state.brand, [['all', t('filter.all')], ...catalog.brands.map((b) => [b.id, b.name])], (brand) => update({ brand })),
      chips(
        t('filter.mounting'),
        state.mounting,
        [['all', t('filter.all')], ['surface', t('mounting.surface')], ['flush', t('mounting.flush')]],
        (mounting) => update({ mounting }),
      ),
      h('ul', { class: 'enclosure-list' }, list.map((e) => h('li', {}, enclosureCard(e)))),
      current &&
        h(
          'button',
          { type: 'button', class: 'link-button', 'aria-expanded': 'true', dataset: { focus: 'picker-toggle' }, onClick: () => update({ pickerOpen: false }) },
          t('enclosure.keep'),
        ),
    );
  }

  function renderItem(item, rowIndex, index) {
    const device = devices.get(item.deviceId);
    const label = deviceLabel(device, t);
    const title = deviceTitle(device, t);
    const selected = state.selectedUid === item.uid;
    return h(
      'button',
      {
        type: 'button',
        class: `item cat-${device.category}`,
        style: { gridColumn: `span ${device.modules * 2}` },
        draggable: 'true',
        title: `${title} · ${device.article}`,
        'aria-label': t('item.position', { title, row: rowIndex + 1, place: index + 1 }),
        'aria-pressed': String(selected),
        dataset: { focus: `item-${item.uid}` },
        onClick: (event) => {
          event.stopPropagation();
          update({ selectedUid: selected ? null : item.uid, activeRow: rowIndex });
        },
        onKeydown: (event) => {
          if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            remove(item.uid);
          }
        },
        onDragstart: dragStart({ uid: item.uid }),
      },
      h('span', { class: 'item-main' }, label.main),
      h('span', { class: 'item-sub' }, label.sub),
    );
  }

  function renderToolbar() {
    const at = findItem(state.board, state.selectedUid);
    if (!at) return null;
    const row = state.board.rows[at.row];
    const device = devices.get(row[at.index].deviceId);
    const uid = state.selectedUid;
    const tool = (key, text, disabled, action) =>
      h('button', { type: 'button', class: 'tool', 'aria-label': t(key), title: t(key), disabled, dataset: { focus: `tool-${key}` }, onClick: action }, text);
    return h(
      'div',
      { class: 'toolbar', role: 'toolbar', 'aria-label': t('item.selected', { title: deviceTitle(device, t) }) },
      h('span', { class: 'toolbar-title' }, t('item.selected', { title: `${deviceTitle(device, t)} (${device.article})` })),
      h(
        'span',
        { class: 'toolbar-buttons' },
        tool('item.moveLeft', '←', at.index === 0, () => move(uid, at.row, at.index - 1)),
        tool('item.moveRight', '→', at.index === row.length - 1, () => move(uid, at.row, at.index + 1)),
        tool('item.moveUp', '↑', at.row === 0, () => move(uid, at.row - 1, at.index)),
        tool('item.moveDown', '↓', at.row === state.board.rows.length - 1, () => move(uid, at.row + 1, at.index)),
        tool('item.remove', '✕', false, () => remove(uid)),
      ),
    );
  }

  function renderBoard() {
    const enc = enclosure();
    const heading = h('h2', { id: 'h-board' }, t('section.board'));
    const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' }, state.status);
    if (!enc) {
      return h('section', { class: 'panel board-panel', 'aria-labelledby': 'h-board' }, heading, h('p', { class: 'hint' }, t('enclosure.choose')), status);
    }
    const stats = boardStats(state.board, enc, devices);
    return h(
      'section',
      { class: 'panel board-panel', 'aria-labelledby': 'h-board' },
      h('div', { class: 'panel-head' }, heading, h('span', { class: 'muted' }, t('board.total', { used: num(stats.used), capacity: stats.capacity, free: num(stats.free) }))),
      h('p', { class: 'hint' }, t('board.activeRowHint')),
      h(
        'div',
        { class: 'cabinet' },
        h('div', { class: 'cabinet-title' }, `${brandNames.get(enc.brand)} ${enclosureTitle(enc)}`),
        state.board.rows.map((items, rowIndex) =>
          h(
            'div',
            { class: `row${rowIndex === state.activeRow ? ' active' : ''}` },
            h(
              'div',
              { class: 'row-head' },
              h(
                'button',
                {
                  type: 'button',
                  class: 'row-select',
                  'aria-pressed': String(rowIndex === state.activeRow),
                  'aria-label': t('board.selectRow', { n: rowIndex + 1 }),
                  dataset: { focus: `row-${rowIndex}` },
                  onClick: () => update({ activeRow: rowIndex }),
                },
                t('board.row', { n: rowIndex + 1 }),
              ),
              h('span', { class: 'muted' }, t('board.rowUsage', { used: num(stats.rows[rowIndex].used), capacity: stats.rows[rowIndex].capacity })),
            ),
            h(
              'div',
              {
                class: 'rail',
                style: { '--cols': enc.modulesPerRow * 2, '--modules': enc.modulesPerRow },
                onClick: () => update({ activeRow: rowIndex, selectedUid: null }),
                onDragover: (event) => {
                  if (!event.dataTransfer.types.includes(DND_TYPE)) return;
                  event.preventDefault();
                  event.currentTarget.classList.add('drop-target');
                },
                onDragleave: (event) => event.currentTarget.classList.remove('drop-target'),
                onDrop: (event) => onDrop(event, rowIndex),
              },
              items.map((item, index) => renderItem(item, rowIndex, index)),
            ),
          ),
        ),
      ),
      renderToolbar(),
      status,
      h('div', { class: 'board-actions' }, h('button', { type: 'button', class: 'link-button', dataset: { focus: 'clear' }, onClick: clearBoard }, t('board.clear'))),
    );
  }

  function renderPalette() {
    const inCategory = catalog.devices.filter((d) => d.category === state.category);
    const poles = POLE_ORDER.filter((p) => inCategory.some((d) => d.specs.poles === p));
    const list = inCategory.filter((d) => state.poles === 'all' || d.specs.poles === state.poles).sort(compareDevices);
    const canAdd = Boolean(state.board);
    return h(
      'section',
      { class: 'panel palette', 'aria-labelledby': 'h-devices' },
      h('h2', { id: 'h-devices' }, t('section.devices')),
      chips(
        t('filter.category'),
        state.category,
        CATEGORY_ORDER.filter((c) => catalog.devices.some((d) => d.category === c)).map((c) => [c, categoryName(c, t)]),
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
                `${brandNames.get(d.brand)} ${d.article} · ${t('device.modules', { n: num(d.modules) })}`,
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
      [enc.article, t('summary.enclosure', { title: `${enclosureTitle(enc)} (${enclosureDescription(enc, t)})` }), 1],
      ...billOfMaterials(state.board).map(({ deviceId, count }) => {
        const d = devices.get(deviceId);
        return [d.article, deviceTitle(d, t), count];
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
        h('tbody', {}, rows.map(([article, name, qty]) => h('tr', {}, h('td', { class: 'mono' }, article), h('td', {}, name), h('td', { class: 'num' }, qty)))),
      ),
    );
  }

  function render(focusFallback) {
    const focusKey = document.activeElement?.dataset?.focus;
    root.replaceChildren(
      // Порядок в разметке = порядок чтения и Tab: корпус, щит, оборудование, состав.
      // На широком экране CSS раскладывает панели в две колонки.
      h('div', { class: 'layout' }, renderEnclosurePicker(), renderBoard(), renderPalette(), renderSummary()),
    );
    // Фокус возвращаем, только если он был внутри конструктора
    if (focusKey) {
      const find = (key) => (key ? root.querySelector(`[data-focus="${CSS.escape(key)}"]`) : null);
      let target = find(focusKey);
      if (!target || target.disabled) target = find(focusFallback);
      target?.focus();
    }
  }

  render();
  return { state, render };
}
