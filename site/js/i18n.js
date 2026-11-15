// Переводы интерфейса. Модуль без DOM.
// Файлы site/i18n/<lang>.json — плоский объект "ключ": "текст".
// В тексте можно подставлять параметры: "Занято {used} из {total}".

export const LANGUAGES = ['ru', 'lt', 'en'];
export const DEFAULT_LANGUAGE = 'ru';
export const LANGUAGE_STORAGE_KEY = 'dinboard.lang';

/**
 * Создаёт функцию перевода t(key, params).
 * Если ключа нет — берётся fallback[key] (русский словарь), а если нет и там — сам ключ
 * (так пропущенный перевод виден на странице, но ничего не ломает).
 * t.lang — язык (для форматирования чисел).
 */
export function createTranslator(messages, fallback = {}, lang = undefined) {
  function t(key, params = {}) {
    const text = Object.hasOwn(messages, key) ? messages[key] : Object.hasOwn(fallback, key) ? fallback[key] : key;
    return String(text).replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(params, name) ? String(params[name]) : match));
  }
  t.lang = lang;
  return t;
}

/** Имена параметров в тексте перевода: "{n} из {total}" → ['n', 'total']. */
export function placeholders(text) {
  return [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

/**
 * Число по правилам языка: 96.5 → «96,5» (ru, lt) или «96.5» (en). Без разделителя тысяч.
 * Без языка — как есть («96.5»).
 */
export function formatNumber(value, lang) {
  const number = Number(value);
  if (!lang) return String(number);
  return new Intl.NumberFormat(lang, { maximumFractionDigits: 2, useGrouping: false }).format(number);
}

/**
 * Язык интерфейса: сохранённый выбор пользователя, иначе первый подходящий язык
 * браузера (lt-LT → lt), иначе русский.
 */
export function pickLanguage(saved, browserLanguages = []) {
  if (LANGUAGES.includes(saved)) return saved;
  for (const tag of browserLanguages) {
    const primary = String(tag).toLowerCase().split('-')[0];
    if (LANGUAGES.includes(primary)) return primary;
  }
  return DEFAULT_LANGUAGE;
}

/** Загружает файл перевода. baseUrl — адрес папки i18n/. */
export async function loadMessages(lang, baseUrl, fetchJson = defaultFetchJson) {
  if (!LANGUAGES.includes(lang)) throw new Error(`Unknown language: ${lang}`);
  const messages = await fetchJson(new URL(`${lang}.json`, baseUrl));
  if (messages === null || typeof messages !== 'object' || Array.isArray(messages)) {
    throw new Error(`Bad messages file: ${lang}.json`);
  }
  return messages;
}

async function defaultFetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json();
}
