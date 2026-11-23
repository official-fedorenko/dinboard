// Фильтры при выборе корпуса: какие корпуса подходят, какие варианты фильтров
// доступны и как делить список на короткий и «ещё варианты». Модуль без DOM.

/** Фильтр → поле корпуса. Значение фильтра 'all' — фильтр не задан. */
export const ENCLOSURE_FILTERS = {
  brand: 'brand',
  mounting: 'mounting',
  modulesPerRow: 'modulesPerRow',
  rowsCount: 'rows',
};

/** Сколько корпусов показывать сразу, остальные — в окне «Ещё варианты». */
export const PREVIEW_COUNT = 3;

/** Подходит ли корпус под фильтры; фильтр skip не учитывается. */
function matches(enclosure, filters, skip = null) {
  return Object.entries(ENCLOSURE_FILTERS).every(
    ([key, field]) => key === skip || filters[key] === undefined || filters[key] === 'all' || enclosure[field] === filters[key],
  );
}

/** Корпуса, подходящие под все фильтры (в исходном порядке). */
export function filterEnclosures(enclosures, filters) {
  return enclosures.filter((e) => matches(e, filters));
}

/**
 * Доступные значения фильтра key: те, с которыми вместе с остальными выбранными
 * фильтрами найдётся хотя бы один корпус. Выбрать недоступное значение нельзя,
 * поэтому сочетание фильтров всегда даёт хотя бы один корпус (если каталог не пуст).
 */
export function availableValues(enclosures, filters, key) {
  const field = ENCLOSURE_FILTERS[key];
  if (!field) throw new Error(`Неизвестный фильтр: ${key}`);
  return new Set(enclosures.filter((e) => matches(e, filters, key)).map((e) => e[field]));
}

/** Короткий список и остальные: { shown, rest }. */
export function previewSplit(list, count = PREVIEW_COUNT) {
  return { shown: list.slice(0, count), rest: list.slice(count) };
}
