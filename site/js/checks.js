// Проверки щита: подсказки для монтажника. Модуль без DOM.
// Проверки не запрещают сборку, а только предупреждают. Каждая подсказка —
// { level: 'warning' | 'info', key, params, deviceId? }: текст берётся из переводов по key,
// а интерфейс может добавить к params название устройства по deviceId.
//
// Вводной аппарат: выключатель нагрузки (рубильник), а если его нет — многополюсный автомат
// с наибольшим номиналом. Фазность ввода — по полюсам вводного аппарата.

import { boardStats } from './board.js';
import { COMB_DEVICE_CATEGORIES } from './catalog.js';
import { carrierClamps, carrierOptions, clampNeed } from './carriers.js';

/** Рекомендуемый запас свободных мест (доля от вместимости щита). */
export const SPARE_SHARE = 0.2;

const THREE_PHASE = new Set(['3P', '3P+N', '4P']);
const SINGLE_PHASE = new Set(['1P+N', '2P']);
const MULTI_POLE = new Set([...THREE_PHASE, ...SINGLE_PHASE]);

/** Подходит ли УЗИП к системе заземления. В TN-C-S после разделения PEN применимы УЗИП для TN-S. */
export function spdFitsEarthing(networks, earthing) {
  return networks.includes(earthing) || (earthing === 'TN-C-S' && networks.includes('TN-S'));
}

/** Вводной аппарат щита: { rating, threePhase } или null. */
export function mainApparatus(list) {
  const switches = list.filter((d) => d.category === 'switch');
  const candidates = switches.length ? switches : list.filter((d) => d.category === 'mcb' && MULTI_POLE.has(d.specs.poles));
  if (!candidates.length) return null;
  const main = candidates.reduce((a, b) => (b.specs.ratedCurrentA > a.specs.ratedCurrentA ? b : a));
  return { rating: main.specs.ratedCurrentA, threePhase: THREE_PHASE.has(main.specs.poles) };
}

// Сколько проводников соединяет гребёнка и сколько полюсов у аппарата
const COMB_WAYS = { '1P': 1, '1P+N': 2, '2P': 2, '3P': 3, '3P+N': 4 };
const DEVICE_WAYS = { '1P': 1, '1P+N': 2, '2P': 2, '3P': 3, '3P+N': 4, '4P': 4 };
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Подходит ли серия аппарата к сериям, которые производитель указал у гребёнки.
 * Написание разное (аппарат «iC60N» — гребёнка «iC60», аппарат «AD» — гребёнка «ADA»),
 * поэтому серии совпадают, если одна начинается с другой (без регистра, пробелов и знаков).
 */
export function seriesMatch(deviceSeries, combSeries) {
  const d = norm(deviceSeries);
  return Boolean(d) && combSeries.some((c) => {
    const x = norm(c);
    return Boolean(x) && (d.startsWith(x) || x.startsWith(d));
  });
}

/**
 * Гребёнки рядов: другой бренд (предупреждение), серия не из списка производителя, аппарат
 * с большим числом полюсов, чем соединяет гребёнка (предупреждение), гребёнка короче ряда.
 */
function checkCombs(board, devices, combsById, warn, info) {
  (board.combs ?? []).forEach((id, row) => {
    const comb = id ? combsById.get(id) : null;
    if (!comb) return;
    const items = (board.rows[row] ?? []).filter((item) => COMB_DEVICE_CATEGORIES.has(devices.get(item.deviceId)?.category));
    if (!items.length) return;
    const list = items.map((item) => devices.get(item.deviceId));
    const n = row + 1;
    if (list.some((d) => d.brand !== comb.brand)) warn('check.combBrand', { row: n, article: comb.article });
    const series = comb.deviceSeries;
    const foreign = series ? [...new Set(list.map((d) => d.series).filter((s) => !seriesMatch(s, series)))] : [];
    if (foreign.length) info('check.combSeries', { row: n, article: comb.article, series: foreign.join(', ') });
    const ways = COMB_WAYS[comb.phases];
    const wide = [...new Set(list.map((d) => d.specs.poles).filter((p) => DEVICE_WAYS[p] > ways))];
    if (wide.length) warn('check.combPhases', { row: n, article: comb.article, phases: comb.phases, poles: wide.join(', ') });
    const start = Math.min(...items.map((i) => i.pos));
    const end = Math.max(...items.map((i) => i.pos + devices.get(i.deviceId).modules));
    if (end - start > comb.lengthModules) info('check.combShort', { row: n, article: comb.article, length: comb.lengthModules, need: end - start });
  });
}

/**
 * Все подсказки для щита. Пустой щит — без подсказок. combsById — гребёнки каталога (Map по id);
 * carrierCatalog — { carriersById, insertsById }: держатели и клеммы N/PE (без него клеммы не проверяются).
 */
export function checkBoard(board, enclosure, devices, combsById = new Map(), carrierCatalog = null) {
  const list = board.rows.flat().map((item) => devices.get(item.deviceId)).filter(Boolean);
  if (!list.length) return [];

  const warnings = [];
  const infos = [];
  const warn = (key, params = {}, deviceId) => warnings.push({ level: 'warning', key, params, ...(deviceId ? { deviceId } : {}) });
  const info = (key, params = {}) => infos.push({ level: 'info', key, params });

  // --- Защита ---
  const main = mainApparatus(list);
  if (!main) warn('check.noMain');

  const residual = list.filter((d) => d.category === 'rcd' || d.category === 'rcbo');
  if (!residual.length) warn('check.noRcd');

  if (main) {
    // УЗО не защищено от перегрузки само — его номинал не должен быть ниже вводного
    const low = [...new Set(list.filter((d) => d.category === 'rcd' && d.specs.ratedCurrentA < main.rating).map((d) => d.specs.ratedCurrentA))];
    for (const rating of low.sort((a, b) => a - b)) warn('check.rcdBelowMain', { rcd: rating, main: main.rating });
  }

  // --- Фазы ---
  if (main && !main.threePhase) {
    const threePhase = list.filter((d) => THREE_PHASE.has(d.specs.poles));
    if (threePhase.length) warn('check.threePhaseOnSingle', { n: threePhase.length });
  }
  // Однофазный УЗИП при трёхфазном вводе — ошибка, только если нет трёхфазного УЗИП, защищающего все фазы
  const spdPoles = list.filter((d) => d.category === 'spd').map((d) => d.specs.poles);
  if (main?.threePhase && spdPoles.some((p) => SINGLE_PHASE.has(p)) && !spdPoles.some((p) => THREE_PHASE.has(p))) {
    warn('check.singlePhaseSpdOnThree');
  }

  // --- УЗИП и система заземления ---
  const spds = list.filter((d) => d.category === 'spd');
  if (spds.length && !board.earthing) info('check.spdNoEarthing');
  if (board.earthing) {
    const seen = new Set();
    for (const spd of spds) {
      const networks = spd.specs.networks;
      if (!networks || seen.has(spd.id) || spdFitsEarthing(networks, board.earthing)) continue;
      seen.add(spd.id);
      warn('check.spdEarthing', { networks: networks.join(', '), earthing: board.earthing }, spd.id);
    }
  }

  // --- Тип УЗО ---
  const typeAC = residual.filter((d) => d.specs.rcdType === 'AC');
  if (typeAC.length) info('check.rcdTypeAC', { n: typeAC.length });

  // --- Клеммы N/PE: по одной N и PE на каждую отходящую линию (автомат, дифавтомат) и на ввод ---
  if (carrierCatalog) {
    const carriers = board.carriers ?? [];
    if (!carriers.length) {
      if (carrierOptions(enclosure, carrierCatalog.carriersById).length) info('check.noCarriers');
    } else {
      const need = clampNeed(board, devices);
      const have = carrierClamps(carriers, carrierCatalog.insertsById);
      for (const role of ['N', 'PE']) {
        if (need.lines && have[role] < need[role]) info('check.fewClamps', { role, need: need[role], lines: need.lines, clamps: have[role] });
      }
    }
  }

  // --- Гребёнки ---
  checkCombs(board, devices, combsById, warn, info);

  // --- Свободные места ---
  const stats = boardStats(board, enclosure, devices);
  if (stats.free / stats.capacity < SPARE_SHARE) {
    info('check.lowSpare', { free: stats.free, percent: Math.round((stats.free / stats.capacity) * 100) });
  }

  return [...warnings, ...infos];
}
