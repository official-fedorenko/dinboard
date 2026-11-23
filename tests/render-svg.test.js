import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { layoutBoard, hitTest, renderBoardSvg, escapeXml, slotRect, carrierBars, CARRIER_MM, combBars, MODULE_MM, FACE_MM } from '../site/js/render-svg.js';
import { createBoard, addDevice, indexById } from '../site/js/board.js';
import { createTranslator } from '../site/js/i18n.js';
import { deviceTitle, deviceLabel } from '../site/js/format.js';
import { SITE_ROOT } from '../tools/serve.js';

const t = createTranslator(JSON.parse(await readFile(join(SITE_ROOT, 'i18n', 'ru.json'), 'utf8')));

const enclosure = { id: 'e', rows: 2, modulesPerRow: 12, dimensionsMm: { width: 305, height: 370, depth: 96.5 } };
const mcb = { id: 'mcb', category: 'mcb', article: 'MCN116', modules: 1, specs: { poles: '1P', ratedCurrentA: 16, curve: 'C', breakingCapacityKa: 6 } };
const rcd = { id: 'rcd', category: 'rcd', article: 'CDA240J', modules: 2, specs: { poles: '2P', ratedCurrentA: 40, sensitivityMa: 30, rcdType: 'A' } };
const spd = { id: 'spd', category: 'spd', article: 'SPE440', modules: 4, specs: { poles: '3P+N', spdType: '2' } };
const devices = indexById([mcb, rcd, spd]);

function sampleBoard() {
  let board = createBoard(enclosure);
  for (const id of ['rcd', 'mcb', 'mcb']) ({ board } = addDevice(board, enclosure, devices, id, { row: 0 }));
  ({ board } = addDevice(board, enclosure, devices, 'spd', { row: 1 }));
  return board;
}

const render = (layout, extra = {}) =>
  renderBoardSvg(layout, devices, { t, deviceTitle, deviceLabel, title: 'Щит', ...extra });

describe('layoutBoard', () => {
  test('рейка по центру корпуса, устройства на своих местах с реальной шириной', () => {
    const layout = layoutBoard(enclosure, sampleBoard(), devices);
    assert.equal(layout.width, 305);
    assert.equal(layout.height, 370);
    const [r0, r1] = layout.rows;
    const railLength = 12 * MODULE_MM;
    assert.equal(r0.x0, (305 - railLength) / 2);
    assert.equal(r0.x1, r0.x0 + railLength);
    assert.deepEqual(
      r0.items.map((i) => [i.deviceId, i.x - r0.x0, i.w]),
      [
        ['rcd', 0, 35],
        ['mcb', 35, 17.5],
        ['mcb', 52.5, 17.5],
      ],
    );
    assert.deepEqual(r0.gaps, [{ x: r0.x0 + 70, w: 8 * MODULE_MM }]);
    assert.equal(r1.items[0].w, 70);
  });

  test('пустые места между устройствами — отдельные заглушки', () => {
    let board = createBoard(enclosure);
    ({ board } = addDevice(board, enclosure, devices, 'mcb', { row: 0, pos: 2 }));
    ({ board } = addDevice(board, enclosure, devices, 'rcd', { row: 0, pos: 7.5 }));
    const layout = layoutBoard(enclosure, board, devices);
    const r0 = layout.rows[0];
    assert.deepEqual(r0.items.map((i) => (i.x - r0.x0) / MODULE_MM), [2, 7.5]);
    assert.deepEqual(r0.gaps.map((g) => [(g.x - r0.x0) / MODULE_MM, g.w / MODULE_MM]), [[0, 2], [3, 4.5], [9.5, 2.5]]);
    const svg = render(layout);
    assert.equal((svg.match(/class="blank"/g) ?? []).length, 4, '3 промежутка в ряду 1 и пустой ряд 2');
    assert.match(svg, /aria-label="УЗО 40 А, 30 мА, тип A, 2P, ряд 1, модуль 8.5"/);
    assert.match(render(layout, { formatNumber: (v) => String(v).replace('.', ',') }), /модуль 8,5"/);
  });

  test('ряды внутри корпуса, по порядку сверху вниз, не пересекаются', () => {
    for (const rows of [1, 2, 3, 4]) {
      const enc = { ...enclosure, rows, dimensionsMm: { width: 305, height: 120 + rows * 125, depth: 96 } };
      const layout = layoutBoard(enc, createBoard(enc), devices);
      layout.rows.forEach((row, i) => {
        assert.ok(row.y > 10 && row.y + row.h < layout.height - 10, `ряд ${i} внутри корпуса`);
        if (i > 0) assert.ok(row.y > layout.rows[i - 1].y + FACE_MM, `ряд ${i} ниже предыдущего`);
      });
    }
  });

  test('ширина рейки зависит от модулей в ряду (не только 12)', () => {
    const enc = { ...enclosure, rows: 1, modulesPerRow: 18, dimensionsMm: { width: 400, height: 250, depth: 100 } };
    const row = layoutBoard(enc, createBoard(enc), devices).rows[0];
    assert.equal(row.x1 - row.x0, 18 * MODULE_MM);
  });
});

describe('hitTest', () => {
  const layout = layoutBoard(enclosure, sampleBoard(), devices);
  const [r0, r1] = layout.rows;

  test('ближайший ряд по высоте', () => {
    assert.equal(hitTest(layout, r0.x0, r0.cy).row, 0);
    assert.equal(hitTest(layout, r0.x0, r1.cy + 30).row, 1);
    assert.equal(hitTest(layout, r0.x0, 0).row, 0);
    assert.equal(hitTest(layout, r0.x0, layout.height).row, 1, 'нижний край корпуса — последний ряд');
  });

  test('место в ряду — в модулях от левого края рейки', () => {
    assert.equal(hitTest(layout, r0.x0, r0.cy).offset, 0);
    assert.equal(hitTest(layout, r0.x0 + 3.5 * MODULE_MM, r0.cy).offset, 3.5);
    assert.equal(hitTest(layout, r0.x1, r0.cy).offset, 12);
    assert.ok(hitTest(layout, 1, r0.cy).offset < 0, 'левее рейки, но в корпусе');
  });

  test('пустой щит без рядов', () => {
    assert.equal(hitTest({ rows: [] }, 0, 0), null);
  });

  test('точка за пределами корпуса — отмена (null)', () => {
    for (const [x, y] of [
      [-1, r0.cy],
      [layout.width + 1, r0.cy],
      [r0.x0, -1],
      [r0.x0, layout.height + 1],
      [-250, layout.height + 300],
    ]) {
      assert.equal(hitTest(layout, x, y), null, `(${x}, ${y})`);
    }
    assert.notEqual(hitTest(layout, 0, 0), null, 'край корпуса ещё внутри');
  });
});

describe('renderBoardSvg', () => {
  const board = sampleBoard();
  const layout = layoutBoard(enclosure, board, devices);

  test('корпус в реальных пропорциях и устройства с подписями', () => {
    const svg = render(layout);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]* viewBox="0 0 305 370"/);
    assert.equal((svg.match(/<g class="dev /g) ?? []).length, 4);
    assert.equal((svg.match(/class="cutout/g) ?? []).length, 2);
    assert.equal((svg.match(/class="blank"/g) ?? []).length, 2, 'свободное место закрыто заглушками');
    assert.match(svg, />C16</);
    assert.match(svg, />40 А</);
    assert.match(svg, /class="dev-test"/, 'у УЗО есть кнопка «Тест»');
    assert.equal((svg.match(/class="dev-indicator"/g) ?? []).length, 4, 'у УЗИП 3P+N — 4 окошка');
    assert.ok(svg.endsWith('</svg>'));
  });

  test('разметка модулей: номера над каждым рядом, деления только на свободных местах', () => {
    const svg = render(layout);
    const grids = svg.match(/<g class="module-grid" aria-hidden="true">.*?<\/g>/g) ?? [];
    assert.equal(grids.length, 2, 'по разметке на ряд');
    const numbers = [...grids[0].matchAll(/class="module-number"[^>]*>(\d+)</g)].map((m) => Number(m[1]));
    assert.deepEqual(numbers, Array.from({ length: 12 }, (_, i) => i + 1));
    assert.equal((grids[0].match(/class="module-tick"/g) ?? []).length, 11);
    // Ряд 1: занято 4 модуля (УЗО 2 + 2 автомата), свободно 8 — между ними 7 делений
    assert.equal((grids[0].match(/class="module-divider"/g) ?? []).length, 7);
    // Деления — на границах модулей внутри свободного места (с 5-го модуля)
    const x0 = layout.rows[0].x0;
    const xs = [...grids[0].matchAll(/class="module-divider" x1="([\d.]+)"/g)].map((m) => Number(m[1]));
    assert.deepEqual(xs, [5, 6, 7, 8, 9, 10, 11].map((i) => Math.round((x0 + i * MODULE_MM) * 100) / 100));
  });

  test('slotRect: место на рейке для подсказки при перетаскивании', () => {
    const r = layout.rows[1];
    assert.deepEqual(slotRect(layout, 1, 4, 2), { x: r.x0 + 4 * MODULE_MM, y: r.y, w: 2 * MODULE_MM, h: FACE_MM });
    assert.deepEqual(slotRect(layout, 0, 2.5, 1).x, layout.rows[0].x0 + 2.5 * MODULE_MM);
    assert.equal(slotRect(layout, 5, 0, 1), null, 'нет такого ряда');
  });

  test('доступность: устройства — кнопки с подписью и ключом фокуса', () => {
    const svg = render(layout, { selectedUid: 2 });
    assert.match(svg, /data-uid="2" data-focus="item-2" tabindex="0" role="button" aria-pressed="true" aria-label="Автомат C16, 1P, ряд 1, модуль 3"/);
    assert.match(svg, /data-uid="1" [^>]*aria-pressed="false"/);
    assert.match(svg, /role="group" aria-label="Щит"/);
  });

  test('выделенный ряд и выбранное устройство', () => {
    const svg = render(layout, { activeRow: 1, selectedUid: 4 });
    assert.match(svg, /class="cutout active" data-row="1"/);
    assert.match(svg, /class="dev cat-spd selected"/);
    assert.match(svg, /class="dev-outline"/);
  });

  test('текст из данных экранируется', () => {
    const evil = { ...mcb, id: 'evil', article: '<script>alert("x")</script>&' };
    const devs = indexById([evil]);
    let b = createBoard(enclosure);
    ({ board: b } = addDevice(b, enclosure, devs, 'evil'));
    const svg = renderBoardSvg(layoutBoard(enclosure, b, devs), devs, { t, deviceTitle, deviceLabel, title: 'a"<b>' });
    assert.ok(!svg.includes('<script>'));
    assert.match(svg, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;&amp;/);
    assert.match(svg, /aria-label="a&quot;&lt;b&gt;"/);
  });

  test('подписи на устройствах читаемого размера и вписываются в ширину', () => {
    const svg = render(layout);
    const sizes = (cls) => [...svg.matchAll(new RegExp(`class="${cls}" x="[^"]+" y="[^"]+" font-size="([\\d.]+)">([^<]*)<`, 'g'))].map((m) => [Number(m[1]), m[2]]);
    const main = sizes('dev-main');
    const sub = sizes('dev-sub');
    assert.equal(main.length, 4);
    assert.equal(sub.length, 4);
    // Автомат в 1 модуль (17.5 мм): «C16» не мельче 7 мм, «1P» не мельче 4.5 мм
    assert.ok(main.find(([, text]) => text === 'C16')[0] >= 7, 'основная подпись автомата');
    assert.ok(sub.find(([, text]) => text === '1P')[0] >= 4.5, 'нижняя подпись автомата');
    // Длинный текст уменьшается, чтобы вписаться: ширина ≈ длина × 0.6 × кегль
    for (const [size, text] of [...main, ...sub]) {
      assert.ok(text.length * 0.6 * size <= 70, `«${text}» (${size} мм) вписывается в устройство`);
    }
  });

  test('escapeXml', () => {
    assert.equal(escapeXml(`<a href='x'>&"`), '&lt;a href=&apos;x&apos;&gt;&amp;&quot;');
  });
});

describe('держатели клемм N/PE на рисунке', () => {
  const board = sampleBoard();
  const layout = layoutBoard(enclosure, board, devices);
  const carriersById = indexById([
    { id: 'qc', kind: 'carrier', article: 'VZ711', lengthMm: 240, positions: ['top', 'bottom'] },
    { id: 'plate', kind: 'plate', article: 'VZ522', lengthMm: 270, positions: ['top'] },
  ]);
  const insertsById = indexById([
    { id: 'n6', role: 'N', article: 'KN06N', clamps: [[1, 16], [5, 4]], widthMm: 30 },
    { id: 'kl', role: 'universal', clamps: [[2, 25], [13, 16]], widthMm: 120 },
    { id: 'npe', role: 'N+PE', clamps: [[10, 16]], widthMm: 100 },
    { id: 'fix', role: 'PE', clamps: [[1, 25], [16, 16]], widthMm: 130, fixed: true },
  ]);
  const bars = (carriers, opts) => carrierBars({ ...board, carriers }, layout, carriersById, insertsById, opts);

  test('держатель — в настоящую длину по центру корпуса, над первым рядом; клеммы — от его левого края', () => {
    const [bar] = bars([{ carrierId: 'qc', position: 'top', included: false, inserts: [{ insertId: 'n6', pos: 10 }, { insertId: 'kl', pos: 50, role: 'PE' }] }]);
    assert.equal(bar.w, 240);
    assert.equal(bar.h, CARRIER_MM);
    assert.equal(bar.x, (layout.width - 240) / 2);
    assert.ok(bar.y + bar.h < layout.rows[0].y - 10, 'выше полосы маркировки первого ряда');
    assert.deepEqual(bar.inserts.map((i) => [i.role, i.x - bar.x, i.w, i.clamps]), [['N', 10, 30, 6], ['PE', 50, 120, 15]]);
  });

  test('внизу — под последним рядом; два на одном месте — друг за другом наружу', () => {
    const list = bars([
      { carrierId: 'qc', position: 'bottom', included: false, inserts: [] },
      { carrierId: 'qc', position: 'bottom', included: false, inserts: [] },
      { carrierId: 'plate', position: 'top', included: true, inserts: [] },
      { carrierId: 'gone', position: 'top', included: false, inserts: [] },
    ]);
    const last = layout.rows.at(-1);
    assert.equal(list.length, 3, 'держатель не из каталога пропускается');
    assert.ok(list[0].y > last.y + FACE_MM);
    assert.ok(list[1].y > list[0].y + list[0].h, 'второй — ниже первого');
    assert.deepEqual(list.map((b) => b.index), [0, 1, 2]);
  });

  test('держателей нет: место пунктиром — только если просили (в корпус можно поставить держатель)', () => {
    assert.deepEqual(bars([]), []);
    const [slot] = bars(undefined, { emptySlot: true });
    assert.equal(slot.slot, true);
    assert.equal(slot.x, layout.rows[0].x0);
  });

  test('в SVG: держатель, клеммы-кнопки с ролью и клеммами, общий N+PE пополам, выделенная — с рамкой', () => {
    const list = bars([
      { carrierId: 'qc', position: 'top', included: false, inserts: [{ insertId: 'n6', pos: 0 }, { insertId: 'npe', pos: 40 }] },
      { carrierId: 'plate', position: 'top', included: true, inserts: [{ insertId: 'fix', pos: 0, included: true }] },
    ]);
    const svg = render(layout, { carriers: list, selectedInsert: { carrier: 0, item: 1 } });
    assert.match(svg, /<g class="carrier kind-carrier" data-carrier-index="0">/);
    assert.match(svg, /<g class="insert role-n" data-carrier="0" data-insert="0" data-focus="insert-0-0" tabindex="0" role="button" aria-pressed="false" aria-label="Клемма N, клемм: 6 · KN06N">/);
    const n6 = svg.match(/<g class="insert role-n".*?<\/g>/)[0];
    assert.equal((n6.match(/class="clamp"/g) ?? []).length, 6);
    assert.match(svg, /class="insert role-npe selected".*?class="ins-n".*?class="ins-pe".*?class="insert-outline"/);
    assert.match(svg, /class="insert role-pe fixed"/);
    const slot = render(layout, { carriers: bars(undefined, { emptySlot: true }) });
    assert.match(slot, /class="carrier kind-slot"/);
    assert.match(slot, />Место под клеммы N\/PE — держатель не выбран</);
  });
});

describe('гребёнки на рисунке', () => {
  const comb = { id: 'c1', brand: 'hager', article: 'KDN163A', phases: '1P', pinType: 'fork', lengthModules: 12 };
  const combsById = new Map([[comb.id, comb]]);
  const board = { ...sampleBoard(), combs: ['c1', 'missing'] };
  const layout = layoutBoard(enclosure, board, devices);

  test('combBars: от первого до последнего аппарата ряда; неизвестная гребёнка пропускается', () => {
    const bars = combBars(layout, board, combsById, devices);
    assert.equal(bars.length, 1);
    const row = layout.rows[0];
    const first = row.items[0];
    const last = row.items.at(-1);
    assert.equal(bars[0].row, 0);
    assert.equal(bars[0].x, first.x + 1);
    assert.equal(Math.round((bars[0].x + bars[0].w) * 100) / 100, Math.round((last.x + last.w - 1) * 100) / 100);
    // Над аппаратами, в зазоре выреза: не закрывает подписи на аппаратах
    assert.ok(bars[0].y >= row.y - 3 && bars[0].y + bars[0].h <= row.y, 'над аппаратами, в зазоре выреза');
  });

  test('ряд без аппаратов, которые соединяет гребёнка (только УЗИП), — без полосы', () => {
    const onlySpd = { ...board, combs: [null, 'c1'] };
    assert.deepEqual(combBars(layout, onlySpd, combsById, devices), []);
  });

  test('в SVG: полоса с подсказкой — артикул и фазы', () => {
    const svg = render(layout, { combs: combBars(layout, board, combsById, devices) });
    assert.match(svg, /<g class="comb pin-fork"><title>KDN163A · Гребёнка 1P, 12 мод\.<\/title><rect class="comb-bar"/);
  });
});
