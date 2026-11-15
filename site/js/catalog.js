// Каталог оборудования: схема данных, проверка и загрузка.
// Модуль без DOM: работает и в браузере, и в Node (тесты).
//
// Файлы данных (site/data/):
//   index.json    — { schemaVersion, brands: [{ id, name, file }] }
//   <brand>.json  — { schemaVersion, brand: { id, name }, enclosures: [...], devices: [...] }
// Описание полей — в docs/ARCHITECTURE.md, раздел «Каталог».

export const SCHEMA_VERSION = 1;

export const POLES = ['1P', '1P+N', '2P', '3P', '3P+N', '4P'];
export const CURVES = ['B', 'C', 'D'];
export const RCD_TYPES = ['AC', 'A', 'F', 'B'];
export const SENSITIVITIES_MA = [10, 30, 100, 300, 500];
export const SPD_TYPES = ['1', '1+2', '1+2+3', '2', '2+3', '3'];
export const MOUNTINGS = ['surface', 'flush'];
export const MATERIALS = ['plastic', 'metal'];
export const DOORS = ['transparent', 'opaque', 'none'];

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FILE_RE = /^[a-z0-9-]+\.json$/;

// --- проверки отдельных значений: возвращают текст ошибки или null ---

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const nonEmptyString = (v) => (typeof v === 'string' && v.trim() !== '' ? null : 'нужна непустая строка');

const oneOf = (list) => (v) => (list.includes(v) ? null : `ожидалось одно из: ${list.join(', ')}`);

const positiveNumber = (v) =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? null : 'нужно положительное число';

const intInRange = (min, max) => (v) =>
  Number.isInteger(v) && v >= min && v <= max ? null : `нужно целое число от ${min} до ${max}`;

const boolean = (v) => (typeof v === 'boolean' ? null : 'нужно true или false');

const id = (v) => (typeof v === 'string' && ID_RE.test(v) ? null : 'id: строчные латинские буквы, цифры и дефисы');

const httpsUrl = (v) => {
  if (typeof v !== 'string') return 'нужна ссылка https://';
  try {
    return new URL(v).protocol === 'https:' ? null : 'нужна ссылка https://';
  } catch {
    return 'нужна ссылка https://';
  }
};

// Ширина устройства в модулях: от 0.5 до 12, шаг 0.5
const moduleWidth = (v) =>
  typeof v === 'number' && v >= 0.5 && v <= 12 && Number.isInteger(v * 2)
    ? null
    : 'ширина в модулях: от 0.5 до 12 с шагом 0.5';

const dimensions = (v) => {
  if (!isObject(v)) return 'нужен объект { width, height, depth } в мм';
  for (const key of ['width', 'height', 'depth']) {
    if (positiveNumber(v[key])) return `${key}: нужно положительное число (мм)`;
  }
  const extra = Object.keys(v).filter((k) => !['width', 'height', 'depth'].includes(k));
  return extra.length ? `лишние поля: ${extra.join(', ')}` : null;
};

// --- схемы объектов: поле → [проверка, обязательное] ---

const ENCLOSURE_FIELDS = {
  id: [id, true],
  brand: [id, true],
  series: [nonEmptyString, true],
  article: [nonEmptyString, true],
  mounting: [oneOf(MOUNTINGS), true],
  rows: [intInRange(1, 12), true],
  modulesPerRow: [intInRange(1, 36), true],
  material: [oneOf(MATERIALS), true],
  door: [oneOf(DOORS), true],
  ipRating: [intInRange(20, 68), true],
  dimensionsMm: [dimensions, true],
  verified: [boolean, true],
  source: [httpsUrl, false],
  notes: [nonEmptyString, false],
};

const DEVICE_FIELDS = {
  id: [id, true],
  brand: [id, true],
  series: [nonEmptyString, true],
  article: [nonEmptyString, true],
  category: [null, true], // проверяется отдельно, вместе со specs
  modules: [moduleWidth, true],
  specs: [null, true],
  verified: [boolean, true],
  source: [httpsUrl, false],
  notes: [nonEmptyString, false],
};

/** Характеристики по категориям устройств. Все поля specs обязательны, лишние запрещены. */
export const DEVICE_CATEGORIES = {
  // Автоматический выключатель
  mcb: {
    poles: oneOf(POLES),
    ratedCurrentA: positiveNumber,
    curve: oneOf(CURVES),
    breakingCapacityKa: positiveNumber,
  },
  // УЗО (выключатель дифференциального тока)
  rcd: {
    poles: oneOf(['1P+N', '2P', '3P+N', '4P']),
    ratedCurrentA: positiveNumber,
    sensitivityMa: oneOf(SENSITIVITIES_MA),
    rcdType: oneOf(RCD_TYPES),
  },
  // Дифавтомат
  rcbo: {
    poles: oneOf(POLES),
    ratedCurrentA: positiveNumber,
    curve: oneOf(CURVES),
    breakingCapacityKa: positiveNumber,
    sensitivityMa: oneOf(SENSITIVITIES_MA),
    rcdType: oneOf(RCD_TYPES),
  },
  // Выключатель нагрузки (рубильник)
  switch: {
    poles: oneOf(POLES),
    ratedCurrentA: positiveNumber,
  },
  // УЗИП
  spd: {
    poles: oneOf(POLES),
    spdType: oneOf(SPD_TYPES),
  },
};

// Только собственные поля: иначе "constructor", "toString", "__proto__" и т.п.
// нашлись бы в прототипе Object и прошли бы проверку как «известные».
const has = (obj, key) => Object.hasOwn(obj, key);

function checkFields(obj, schema, path, errors) {
  if (!isObject(obj)) {
    errors.push(`${path}: нужен объект`);
    return false;
  }
  for (const [key, [check, required]] of Object.entries(schema)) {
    if (!has(obj, key)) {
      if (required) errors.push(`${path}.${key}: обязательное поле`);
      continue;
    }
    const problem = check ? check(obj[key]) : null;
    if (problem) errors.push(`${path}.${key}: ${problem}`);
  }
  for (const key of Object.keys(obj)) {
    if (!has(schema, key)) errors.push(`${path}.${key}: неизвестное поле`);
  }
  return true;
}

// Подтверждённая позиция обязана ссылаться на источник
function checkSource(item, path, errors) {
  if (isObject(item) && item.verified === true && !has(item, 'source')) {
    errors.push(`${path}.source: обязательно при verified: true`);
  }
}

/** Схема характеристик для категории или null, если категории нет. */
export function categorySchema(category) {
  return typeof category === 'string' && has(DEVICE_CATEGORIES, category) ? DEVICE_CATEGORIES[category] : null;
}

function checkDevice(device, path, errors) {
  if (!checkFields(device, DEVICE_FIELDS, path, errors)) return;
  const specSchema = categorySchema(device.category);
  if (!specSchema) {
    errors.push(`${path}.category: ожидалось одно из: ${Object.keys(DEVICE_CATEGORIES).join(', ')}`);
    return;
  }
  if (!isObject(device.specs)) {
    errors.push(`${path}.specs: нужен объект`);
    return;
  }
  const specFields = Object.fromEntries(Object.entries(specSchema).map(([k, check]) => [k, [check, true]]));
  checkFields(device.specs, specFields, `${path}.specs`, errors);
}

/** Проверяет index.json. Возвращает список ошибок (пустой — всё в порядке). */
export function validateIndex(index) {
  const errors = [];
  if (!isObject(index)) return ['index: нужен объект'];
  if (index.schemaVersion !== SCHEMA_VERSION) errors.push(`index.schemaVersion: ожидалось ${SCHEMA_VERSION}`);
  if (!Array.isArray(index.brands) || index.brands.length === 0) {
    errors.push('index.brands: нужен непустой список');
    return errors;
  }
  const seen = new Set();
  index.brands.forEach((brand, i) => {
    const path = `index.brands[${i}]`;
    checkFields(
      brand,
      {
        id: [id, true],
        name: [nonEmptyString, true],
        file: [(v) => (typeof v === 'string' && FILE_RE.test(v) ? null : 'имя файла вида brand.json'), true],
      },
      path,
      errors,
    );
    if (isObject(brand) && typeof brand.id === 'string') {
      if (seen.has(brand.id)) errors.push(`${path}.id: повтор "${brand.id}"`);
      seen.add(brand.id);
    }
  });
  for (const key of Object.keys(index)) {
    if (!['schemaVersion', 'brands'].includes(key)) errors.push(`index.${key}: неизвестное поле`);
  }
  return errors;
}

/** Проверяет файл бренда. name — имя файла для сообщений. */
export function validateBrandFile(data, name = 'brand') {
  const errors = [];
  if (!isObject(data)) return [`${name}: нужен объект`];
  if (data.schemaVersion !== SCHEMA_VERSION) errors.push(`${name}.schemaVersion: ожидалось ${SCHEMA_VERSION}`);
  checkFields(data.brand, { id: [id, true], name: [nonEmptyString, true] }, `${name}.brand`, errors);
  const brandId = isObject(data.brand) ? data.brand.id : undefined;

  for (const listName of ['enclosures', 'devices']) {
    if (!Array.isArray(data[listName])) {
      errors.push(`${name}.${listName}: нужен список`);
      continue;
    }
    data[listName].forEach((item, i) => {
      const path = `${name}.${listName}[${i}]`;
      if (listName === 'enclosures') checkFields(item, ENCLOSURE_FIELDS, path, errors);
      else checkDevice(item, path, errors);
      checkSource(item, path, errors);
      if (isObject(item) && item.brand !== brandId) errors.push(`${path}.brand: должен совпадать с "${brandId}"`);
    });
  }
  for (const key of Object.keys(data)) {
    if (!['schemaVersion', 'brand', 'enclosures', 'devices'].includes(key)) {
      errors.push(`${name}.${key}: неизвестное поле`);
    }
  }
  return errors;
}

/** Проверяет уже собранный каталог целиком: уникальность id во всех брендах. */
export function validateCatalog(catalog) {
  const errors = [];
  const seen = new Map();
  for (const item of [...catalog.enclosures, ...catalog.devices]) {
    if (seen.has(item.id)) errors.push(`id "${item.id}" повторяется (${seen.get(item.id)} и ${item.brand})`);
    else seen.set(item.id, item.brand);
  }
  return errors;
}

export class CatalogError extends Error {
  constructor(errors) {
    super(`Ошибки в каталоге (${errors.length}):\n${errors.join('\n')}`);
    this.name = 'CatalogError';
    this.errors = errors;
  }
}

/**
 * Загружает и проверяет каталог.
 * baseUrl — адрес папки с данными (например, new URL('data/', document.baseURI)).
 * fetchJson(url) — функция загрузки JSON (в браузере по умолчанию через fetch).
 * Возвращает { brands, enclosures, devices }. При ошибках бросает CatalogError.
 */
export async function loadCatalog(baseUrl, fetchJson = defaultFetchJson) {
  const index = await fetchJson(new URL('index.json', baseUrl));
  const indexErrors = validateIndex(index);
  if (indexErrors.length) throw new CatalogError(indexErrors);

  const files = await Promise.all(index.brands.map((b) => fetchJson(new URL(b.file, baseUrl))));
  const errors = [];
  const catalog = { brands: [], enclosures: [], devices: [] };

  files.forEach((data, i) => {
    const entry = index.brands[i];
    const fileErrors = validateBrandFile(data, entry.file);
    if (!fileErrors.length && data.brand.id !== entry.id) {
      fileErrors.push(`${entry.file}.brand.id: "${data.brand.id}" не совпадает с index.json ("${entry.id}")`);
    }
    if (fileErrors.length) {
      errors.push(...fileErrors);
      return;
    }
    catalog.brands.push({ id: data.brand.id, name: data.brand.name });
    catalog.enclosures.push(...data.enclosures);
    catalog.devices.push(...data.devices);
  });

  errors.push(...validateCatalog(catalog));
  if (errors.length) throw new CatalogError(errors);
  return catalog;
}

async function defaultFetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось загрузить ${url}: ${res.status}`);
  return res.json();
}
