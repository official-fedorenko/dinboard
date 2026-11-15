// Переводы интерфейса. Модуль без DOM.
// Файлы site/i18n/<lang>.json — плоский объект "ключ": "текст".
// В тексте можно подставлять параметры: "Занято {used} из {total}".

export const LANGUAGES = ['ru', 'lt', 'en'];
export const DEFAULT_LANGUAGE = 'ru';

/**
 * Создаёт функцию перевода t(key, params).
 * Если ключа нет — возвращает fallback[key], а если нет и там — сам ключ
 * (так пропущенный перевод виден на странице, но ничего не ломает).
 */
export function createTranslator(messages, fallback = {}) {
  return function t(key, params = {}) {
    const text = Object.hasOwn(messages, key) ? messages[key] : Object.hasOwn(fallback, key) ? fallback[key] : key;
    return String(text).replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(params, name) ? String(params[name]) : match));
  };
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
