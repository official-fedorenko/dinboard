// Держатели клемм N/PE в корпусе: «мини-рейка» вверху или внизу, на ней клеммы разной ширины.
// Модуль без DOM: чистые функции, данные не меняются (возвращаются новые объекты).
//
// Держатель щита: { carrierId, position: 'top' | 'bottom', included, inserts: [{ insertId, pos, role?, included? }] }
//   pos — отступ клеммы от левого края держателя, мм; role — для универсальной клеммы (роль задаёт крышка);
//   included — стоит с завода (в составе «в комплекте корпуса»).
// Каталог: carriersById — держатели { id, lengthMm, positions, ... }, insertsById — клеммы
//   { id, role: N | PE | N+PE | L | universal, clamps: [[число, мм²]], widthMm, carrierIds }.

export const CARRIER_POSITIONS = ['top', 'bottom'];
/** Коды ошибок CarrierError (тексты — carrier.error.<код> в переводах). */
export const CARRIER_ERROR_CODES = ['occupied', 'too-wide', 'bad-pos', 'unknown-insert', 'not-compatible', 'bad-carrier'];
/** Шаг, к которому притягивается клемма при перетаскивании, мм. */
export const INSERT_STEP_MM = 0.5;

export class CarrierError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'CarrierError';
    this.code = code; // один из CARRIER_ERROR_CODES
    this.details = details;
  }
}

/** Роль клеммы в щите: у универсальной — выбранная (или N по умолчанию). */
export function insertRole(item, insert) {
  return insert.role === 'universal' ? item.role ?? 'N' : insert.role;
}

/** Число клемм в группах [[число, мм²]]. */
export const clampCount = (clamps) => (clamps ?? []).reduce((sum, [count]) => sum + count, 0);

/** Сколько клемм даёт клемма для роли N или PE (общий блок N+PE — поровну). */
export function clampsFor(item, insert, role) {
  const own = insertRole(item, insert);
  const total = clampCount(insert.clamps);
  if (own === role) return total;
  if (own === 'N+PE') return Math.floor(total / 2);
  return 0;
}

/** Свободные промежутки держателя, мм: [{ start, end }]; ignore — индекс клеммы, которую не учитывать. */
export function carrierGaps(carrier, carriersById, insertsById, ignore = -1) {
  const length = carriersById.get(carrier.carrierId)?.lengthMm ?? 0;
  const busy = carrier.inserts
    .map((item, i) => ({ i, start: item.pos, end: item.pos + (insertsById.get(item.insertId)?.widthMm ?? 0) }))
    .filter((b) => b.i !== ignore)
    .sort((a, b) => a.start - b.start);
  const gaps = [];
  let x = 0;
  for (const b of busy) {
    if (b.start - x > 1e-6) gaps.push({ start: x, end: b.start });
    x = Math.max(x, b.end);
  }
  if (length - x > 1e-6) gaps.push({ start: x, end: length });
  return gaps;
}

/** Помещается ли клемма шириной width с позиции pos. */
export function canPlaceInsert(carrier, carriersById, insertsById, pos, width, ignore = -1) {
  return carrierGaps(carrier, carriersById, insertsById, ignore).some((g) => pos >= g.start - 1e-6 && pos + width <= g.end + 1e-6);
}

/** Первое свободное место для клеммы шириной width или null. */
export function firstFreeInsertPos(carrier, carriersById, insertsById, width, ignore = -1) {
  const gap = carrierGaps(carrier, carriersById, insertsById, ignore).find((g) => g.end - g.start >= width - 1e-6);
  return gap ? gap.start : null;
}

/**
 * Позиция при перетаскивании: raw — где оказался левый край клеммы, мм.
 * Вплотную к соседу или краю держателя, если до него не больше 5 мм, иначе — шаг 0,5 мм.
 * В пределах держателя; занято ли место — проверяет перенос. null — клемма длиннее держателя.
 */
export function snapInsertPos(carrier, carriersById, insertsById, raw, width, ignore = -1) {
  const length = carriersById.get(carrier.carrierId)?.lengthMm ?? 0;
  const max = length - width;
  if (max < -1e-6) return null;
  const edges = [0, max];
  carrier.inserts.forEach((item, i) => {
    if (i === ignore) return;
    const w = insertsById.get(item.insertId)?.widthMm ?? 0;
    edges.push(item.pos + w, item.pos - width);
  });
  const near = edges.filter((e) => e >= -1e-6 && e <= max + 1e-6 && Math.abs(e - raw) <= 5).sort((a, b) => Math.abs(a - raw) - Math.abs(b - raw));
  const free = near.find((e) => canPlaceInsert(carrier, carriersById, insertsById, e, width, ignore));
  if (free !== undefined) return Math.max(0, Math.min(max, free));
  return Math.max(0, Math.min(max, Math.round(raw / INSERT_STEP_MM) * INSERT_STEP_MM));
}

function withCarrier(carriers, index, carrier) {
  return carriers.map((c, i) => (i === index ? carrier : c));
}

function checkIndex(carriers, index) {
  if (!Number.isInteger(index) || index < 0 || index >= carriers.length) throw new CarrierError('bad-carrier', { index });
}

/**
 * Добавляет клемму insertId в держатель index: на место pos или на первое свободное.
 * role — для универсальной клеммы. Ошибки: unknown-insert, not-compatible, occupied, too-wide.
 */
export function addInsert(carriers, index, insertId, carriersById, insertsById, { pos, role } = {}) {
  checkIndex(carriers, index);
  const carrier = carriers[index];
  const insert = insertsById.get(insertId);
  if (!insert) throw new CarrierError('unknown-insert', { insertId });
  if (insert.carrierIds && !insert.carrierIds.includes(carrier.carrierId)) throw new CarrierError('not-compatible', { insertId });
  let at = pos;
  if (at === undefined) {
    at = firstFreeInsertPos(carrier, carriersById, insertsById, insert.widthMm);
    if (at === null) throw new CarrierError('too-wide', { insertId });
  } else if (!canPlaceInsert(carrier, carriersById, insertsById, at, insert.widthMm)) {
    throw new CarrierError('occupied', { insertId, pos: at });
  }
  const item = { insertId, pos: at, ...(insert.role === 'universal' ? { role: role ?? 'N' } : {}) };
  return withCarrier(carriers, index, { ...carrier, inserts: [...carrier.inserts, item].sort((a, b) => a.pos - b.pos) });
}

/** Переносит клемму item держателя index на позицию pos (в том же держателе). Ошибка occupied. */
export function moveInsert(carriers, index, item, pos, carriersById, insertsById) {
  checkIndex(carriers, index);
  const carrier = carriers[index];
  const current = carrier.inserts[item];
  if (!current) throw new CarrierError('bad-pos', { item });
  const width = insertsById.get(current.insertId)?.widthMm ?? 0;
  if (!canPlaceInsert(carrier, carriersById, insertsById, pos, width, item)) throw new CarrierError('occupied', { pos });
  const inserts = carrier.inserts.map((x, i) => (i === item ? { ...x, pos } : x)).sort((a, b) => a.pos - b.pos);
  return withCarrier(carriers, index, { ...carrier, inserts });
}

/**
 * Переносит клемму item из держателя from в держатель to на позицию pos (например, сверху вниз).
 * Роль и «с завода» сохраняются (деталь та же). Ошибки: bad-pos (нет такой клеммы), not-compatible, occupied.
 */
export function transferInsert(carriers, from, item, to, pos, carriersById, insertsById) {
  checkIndex(carriers, from);
  checkIndex(carriers, to);
  const current = carriers[from].inserts[item];
  if (!current) throw new CarrierError('bad-pos', { item });
  const insert = insertsById.get(current.insertId);
  const target = carriers[to];
  if (insert?.carrierIds && !insert.carrierIds.includes(target.carrierId)) throw new CarrierError('not-compatible', { insertId: current.insertId });
  if (!canPlaceInsert(target, carriersById, insertsById, pos, insert?.widthMm ?? 0)) throw new CarrierError('occupied', { pos });
  return carriers.map((c, i) => {
    if (i === from) return { ...c, inserts: c.inserts.filter((_, k) => k !== item) };
    if (i === to) return { ...c, inserts: [...c.inserts, { ...current, pos }].sort((a, b) => a.pos - b.pos) };
    return c;
  });
}

/**
 * Меняет клемму item держателя index на клемму insertId (другого размера или роли): на то же место,
 * а если там не помещается — на первое свободное. Новая клемма — к заказу. Ошибки: как у addInsert.
 */
export function replaceInsert(carriers, index, item, insertId, carriersById, insertsById) {
  checkIndex(carriers, index);
  const current = carriers[index].inserts[item];
  if (!current) throw new CarrierError('bad-pos', { item });
  const without = removeInsert(carriers, index, item);
  const insert = insertsById.get(insertId);
  const role = insert?.role === 'universal' ? current.role : undefined;
  if (insert && canPlaceInsert(without[index], carriersById, insertsById, current.pos, insert.widthMm)) {
    return addInsert(without, index, insertId, carriersById, insertsById, { pos: current.pos, role });
  }
  return addInsert(without, index, insertId, carriersById, insertsById, { role });
}

/** Убирает клемму item из держателя index. */
export function removeInsert(carriers, index, item) {
  checkIndex(carriers, index);
  const carrier = carriers[index];
  return withCarrier(carriers, index, { ...carrier, inserts: carrier.inserts.filter((_, i) => i !== item) });
}

/** Роль универсальной клеммы (N или PE — по крышке). */
export function setInsertRole(carriers, index, item, role) {
  checkIndex(carriers, index);
  const carrier = carriers[index];
  return withCarrier(carriers, index, { ...carrier, inserts: carrier.inserts.map((x, i) => (i === item ? { ...x, role } : x)) });
}

/** Переставляет держатель вверх или вниз (если такое место у держателя есть). */
export function setCarrierPosition(carriers, index, position, carriersById) {
  checkIndex(carriers, index);
  const allowed = carriersById.get(carriers[index].carrierId)?.positions ?? CARRIER_POSITIONS;
  if (!allowed.includes(position)) throw new CarrierError('bad-pos', { position });
  return withCarrier(carriers, index, { ...carriers[index], position });
}

/** Клемм N и PE во всех держателях щита: { N, PE }. */
export function carrierClamps(carriers, insertsById) {
  const total = { N: 0, PE: 0 };
  for (const c of carriers ?? []) {
    for (const item of c.inserts) {
      const insert = insertsById.get(item.insertId);
      if (!insert) continue;
      total.N += clampsFor(item, insert, 'N');
      total.PE += clampsFor(item, insert, 'PE');
    }
  }
  return total;
}

/** Доля клемм для роли N или PE у клеммника на рейке (общий N+PE — поровну). */
export const railShare = (t, role) => (t.role === role ? t.clamps : t.role === 'N+PE' ? Math.floor(t.clamps / 2) : 0);

/**
 * Шины N щита: число клемм N у каждой отдельной шины — клеммы в держателях (у общей N+PE — половина)
 * и клеммники на DIN-рейку (rail из railTerminals).
 */
export function neutralBars(carriers, insertsById, rail = []) {
  const bars = [];
  for (const c of carriers ?? []) {
    for (const item of c.inserts) {
      const insert = insertsById.get(item.insertId);
      const n = insert ? clampsFor(item, insert, 'N') : 0;
      if (n > 0) bars.push(n);
    }
  }
  for (const t of rail) if (railShare(t, 'N') > 0) bars.push(railShare(t, 'N'));
  return bars;
}

/**
 * Чего не хватает до need (из clampNeed): { N, PE, bars, haveBars, unmet }.
 * У каждой группы УЗО своя шина N (самая маленькая подходящая; если ни одна не подходит — самая большая
 * из оставшихся), общей нужде (ввод, входы УЗО, линии без УЗО) — все остальные шины N вместе (их можно соединить).
 * N и PE — сколько клемм не хватает; bars — сколько шин N нужно (группы + общая), haveBars — сколько есть;
 * unmet — размеры шин, которые нужно добавить (для группы — целиком, для общей — сколько не хватает).
 * Схема соединений не моделируется: какие автоматы за каким УЗО — по расстановке (см. clampNeed).
 */
export function clampShortage(carriers, need, insertsById, rail = []) {
  const groups = [...(need.groups ?? [])].sort((a, b) => b - a);
  const mainN = need.mainN ?? need.N - groups.reduce((s, g) => s + g, 0);
  const free = neutralBars(carriers, insertsById, rail).sort((a, b) => a - b);
  const haveBars = free.length;
  const unmet = [];
  let shortN = 0;
  for (const g of groups) {
    let i = free.findIndex((b) => b >= g);
    if (i < 0) i = free.length - 1;
    const got = i >= 0 ? free.splice(i, 1)[0] : 0;
    if (got < g) {
      unmet.push(g);
      shortN += g - got;
    }
  }
  const rest = free.reduce((s, b) => s + b, 0);
  if (rest < mainN) {
    unmet.push(mainN - rest);
    shortN += mainN - rest;
  }
  const pe = carrierClamps(carriers, insertsById).PE + railClamps(rail, 'PE');
  return { N: shortN, PE: Math.max(0, need.PE - pe), bars: groups.length + 1, haveBars, unmet };
}

/**
 * Подбор по числу линий (need — из clampNeed, rail — клеммники на рейке, они тоже считаются).
 * N: для каждой группы УЗО, у которой нет своей подходящей шины, и для общей шины, если в ней мало клемм, в держатели
 * добавляется отдельная клемма N; PE — пока клемм не хватит. Берётся самая маленькая подходящая клемма (своей роли,
 * универсальная или общая N+PE; подтверждённые источником — раньше), а если ни одна не хватает — самая большая
 * (и так, пока не хватит или есть место). Заводские клеммы остаются.
 * Возвращает { carriers, short: { N, PE } } — short: сколько клемм всё ещё не хватает.
 */
export function autoFill(carriers, need, carriersById, insertsById, rail = []) {
  let next = carriers;
  for (const role of ['N', 'PE']) {
    let guard = 0;
    while (guard++ < 12) {
      const s = clampShortage(next, need, insertsById, rail);
      if (!s[role]) break;
      // N — шина нужного размера целиком (своя для группы УЗО), PE — сколько не хватает
      const missing = role === 'N' ? s.unmet[0] : s.PE;
      let placed = false;
      for (let index = 0; index < next.length && !placed; index++) {
        const carrier = next[index];
        const gives = (x) => clampsFor({ role }, x, role);
        const options = insertOptions(carrier.carrierId, insertsById)
          .filter((x) => gives(x) > 0)
          .filter((x) => firstFreeInsertPos(carrier, carriersById, insertsById, x.widthMm) !== null)
          .sort((a, b) => gives(a) - gives(b) || a.widthMm - b.widthMm);
        // Из подходящих — сначала подтверждённые источником
        const enough = options.filter((x) => gives(x) >= missing);
        const pick = enough.find((x) => x.verified !== false) ?? enough[0] ?? options.at(-1);
        if (!pick) continue;
        next = addInsert(next, index, pick.id, carriersById, insertsById, { role });
        placed = true;
      }
      if (!placed) break;
    }
  }
  const s = clampShortage(next, need, insertsById, rail);
  return { carriers: next, short: { N: s.N, PE: s.PE } };
}

/**
 * «В комплекте корпуса» (included) по комплектации корпуса enclosure (terminalSetup), а не по прежним флагам:
 * держатель — заводской, если он совпадает с первым ещё не сопоставленным заводским держателем того же id;
 * клемма — заводская, если она стоит в таком держателе и в нём с завода есть клемма того же id
 * (место не важно: сдвинутая заводская клемма — та же деталь). Остальное — к заказу.
 */
export function markFactory(carriers, enclosure) {
  const factory = factoryCarriers(enclosure).filter((f) => f.included);
  const pool = []; // заводские клеммы, не найденные в своём держателе (их перенесли в другой)
  const marked = carriers.map((c) => {
    const at = factory.findIndex((f) => f.carrierId === c.carrierId);
    const fromFactory = at >= 0 ? factory.splice(at, 1)[0] : null;
    const left = (fromFactory?.inserts ?? []).filter((x) => x.included).map((x) => x.insertId);
    const inserts = c.inserts.map(({ included, ...item }) => {
      const k = left.indexOf(item.insertId);
      if (k < 0) return item;
      left.splice(k, 1);
      return { ...item, included: true };
    });
    pool.push(...left);
    return { ...c, included: Boolean(fromFactory), inserts };
  });
  for (const id of factory.flatMap((f) => f.inserts.filter((x) => x.included).map((x) => x.insertId))) pool.push(id);
  // Перенесённые заводские клеммы — та же деталь из коробки: первые такие же клеммы в других держателях
  return marked.map((c) => ({
    ...c,
    inserts: c.inserts.map((item) => {
      if (item.included) return item;
      const k = pool.indexOf(item.insertId);
      if (k < 0) return item;
      pool.splice(k, 1);
      return { ...item, included: true };
    }),
  }));
}

/** Держатели щита по комплектации корпуса (enclosure.terminalSetup), как с завода. */
export function factoryCarriers(enclosure) {
  return (enclosure.terminalSetup?.carriers ?? []).map((c) => ({
    carrierId: c.carrierId,
    position: c.position ?? 'top',
    included: Boolean(c.included),
    inserts: (c.inserts ?? []).map((x) => ({ insertId: x.insertId, pos: x.pos ?? 0, ...(x.role ? { role: x.role } : {}), ...(x.included ? { included: true } : {}) })),
  }));
}

/** Держатели каталога, которые ставятся в корпус (enclosureIds; без списка — в любой корпус бренда). */
export function carrierOptions(enclosure, carriersById) {
  return [...carriersById.values()].filter((c) =>
    c.enclosureIds ? c.enclosureIds.includes(enclosure.id) : c.brand === enclosure.brand,
  );
}

/**
 * Держатели, которые можно добавить или поставить на замену: то, что можно заказать (держатель с артикулом),
 * и штатные места под шину. Заводские колодки и держатели без артикула (не продаются отдельно) — только «как с завода».
 */
export function addableCarriers(enclosure, carriersById) {
  return carrierOptions(enclosure, carriersById).filter((c) => c.kind === 'zone' || (c.kind === 'carrier' && c.article));
}

/** Клеммы, которые можно поставить в держатель carrierId (кроме частей заводских колодок). */
export function insertOptions(carrierId, insertsById) {
  return [...insertsById.values()].filter((x) => !x.fixed && (!x.carrierIds || x.carrierIds.includes(carrierId)));
}

/** Добавляет пустой держатель carrierId на место position (по умолчанию — первое разрешённое). */
export function addCarrier(carriers, carrierId, carriersById, position) {
  const carrier = carriersById.get(carrierId);
  if (!carrier) throw new CarrierError('bad-carrier', { carrierId });
  const at = position ?? carrier.positions[0];
  if (!carrier.positions.includes(at)) throw new CarrierError('bad-pos', { position: at });
  return [...carriers, { carrierId, position: at, included: false, inserts: [] }];
}

/** Убирает держатель index вместе с его клеммами. */
export function removeCarrier(carriers, index) {
  checkIndex(carriers, index);
  return carriers.filter((_, i) => i !== index);
}

/**
 * Меняет держатель index на carrierId (например, заводскую колодку — на держатель с переставными клеммами).
 * Место сохраняется, если новый держатель туда ставится; клеммы переходят, если подходят и помещаются.
 * Новый держатель — к заказу (included: false).
 */
export function swapCarrier(carriers, index, carrierId, carriersById, insertsById) {
  checkIndex(carriers, index);
  const carrier = carriersById.get(carrierId);
  if (!carrier) throw new CarrierError('bad-carrier', { carrierId });
  const old = carriers[index];
  const position = carrier.positions.includes(old.position) ? old.position : carrier.positions[0];
  let next = withCarrier(carriers, index, { carrierId, position, included: false, inserts: [] });
  for (const item of old.inserts) {
    const insert = insertsById.get(item.insertId);
    if (!insert || insert.fixed) continue;
    try {
      next = addInsert(next, index, item.insertId, carriersById, insertsById, { pos: item.pos, role: item.role });
    } catch {
      try {
        next = addInsert(next, index, item.insertId, carriersById, insertsById, { role: item.role });
      } catch {
        // не подходит или не помещается — не переносится
      }
    }
  }
  return next;
}

const SPD_WITH_N = new Set(['1P+N', '3P+N']);

/**
 * Сколько клемм N и PE нужно: { N, PE, lines, groups, mainN, rcds, spds, spdsN }.
 * PE — по одной на каждую отходящую линию (автомат, дифавтомат), на ввод и на каждый УЗИП.
 * N делится по группам УЗО: нейтрали группы идут на свою шину N (общая N на выходе разных УЗО даёт
 * ложные срабатывания). Схема соединений не моделируется, поэтому группа — УЗО и автоматы правее него
 * в том же ряду до следующего УЗО или рубильника; groups — число линий каждой группы (пустые не считаются).
 * mainN — общая шина N: ввод, вход каждого УЗО, автоматы без УЗО, дифавтоматы, УЗИП с нейтралью.
 * lines — число отходящих линий (автоматы и дифавтоматы); rcds — число УЗО (вход каждого — на общей шине N); spds — число УЗИП (каждому — клемма PE),
 * spdsN — из них с нейтралью (им ещё клемма N).
 */
export function clampNeed(board, devices) {
  let lines = 0;
  let rcds = 0;
  let spds = 0;
  let spdsN = 0;
  let mainN = 1;
  const groups = [];
  for (const row of board.rows) {
    let group = null; // группа УЗО не переходит в другой ряд
    for (const item of row) {
      const device = devices.get(item.deviceId);
      switch (device?.category) {
        case 'rcd':
          rcds += 1;
          mainN += 1;
          group = groups.push(0) - 1;
          break;
        case 'switch':
          group = null;
          break;
        case 'mcb':
          lines += 1;
          if (group === null) mainN += 1;
          else groups[group] += 1;
          break;
        case 'rcbo':
          lines += 1;
          mainN += 1;
          break;
        case 'spd':
          spds += 1;
          if (SPD_WITH_N.has(device.specs?.poles)) {
            mainN += 1;
            spdsN += 1;
          }
          break;
        default:
          break;
      }
    }
  }
  const used = groups.filter((g) => g > 0);
  return { N: mainN + used.reduce((s, g) => s + g, 0), PE: lines + 1 + spds, lines, groups: used, mainN, rcds, spds, spdsN };
}

/** Клемм роли N или PE во всех клеммниках на рейке (rail из railTerminals). */
export function railClamps(rail, role) {
  return rail.reduce((s, t) => s + railShare(t, role), 0);
}

/** Клеммники N/PE на DIN-рейку в щите (категория terminal, с числом клемм): [{ role, clamps }]. */
export function railTerminals(board, devices) {
  const out = [];
  for (const row of board.rows) {
    for (const item of row) {
      const device = devices.get(item.deviceId);
      if (device?.category !== 'terminal' || !device.specs?.clamps) continue;
      out.push({ role: device.specs.role, clamps: clampCount(device.specs.clamps) });
    }
  }
  return out;
}
