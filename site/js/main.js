// Точка входа: выбирает язык, загружает каталог и переводы, восстанавливает щит
// (из ссылки или из хранилища браузера) и запускает интерфейс конструктора.

import { loadCatalog } from './catalog.js';
import { loadMessages, createTranslator, pickLanguage, LANGUAGES, DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY } from './i18n.js';
import { indexById } from './board.js';
import { createLocalStore, restoreProject } from './storage.js';
import { mountApp } from './ui.js';
import { h } from './dom.js';

const root = document.getElementById('app');
const langBox = document.getElementById('lang');
const base = document.baseURI;
const html = document.documentElement;
const i18nBase = new URL('i18n/', base);

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined; // хранилище запрещено настройками браузера
  }
}

function readSavedLanguage(storage) {
  try {
    return storage?.getItem(LANGUAGE_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function saveLanguage(storage, lang) {
  try {
    storage?.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // выбор языка просто не запомнится
  }
}

// Загруженные словари: русский нужен всегда — как запасной для недостающих ключей
const loaded = new Map();
async function messagesFor(lang) {
  if (!loaded.has(lang)) loaded.set(lang, await loadMessages(lang, i18nBase));
  return loaded.get(lang);
}

/**
 * Переключатель RU / LT / EN в шапке.
 * Если фокус был в переключателе, после перерисовки он остаётся на кнопке текущего языка.
 */
function renderLanguageSwitcher(current, t, onPick) {
  if (!langBox) return;
  const hadFocus = langBox.contains(document.activeElement);
  langBox.replaceChildren(
    h(
      'div',
      { class: 'lang-switch', role: 'group', 'aria-label': t('language.label') },
      LANGUAGES.map((code) =>
        h(
          'button',
          {
            type: 'button',
            class: 'lang-button',
            lang: code,
            'aria-pressed': String(code === current),
            'aria-label': t(`language.${code}`),
            title: t(`language.${code}`),
            dataset: { focus: `lang-${code}` },
            onClick: () => onPick(code),
          },
          code.toUpperCase(),
        ),
      ),
    ),
  );
  if (hadFocus) langBox.querySelector(`[data-focus="lang-${current}"]`)?.focus();
}

const storage = browserStorage();
let lang = pickLanguage(readSavedLanguage(storage), navigator.languages ?? [navigator.language]);
let t = createTranslator({});
try {
  const ru = await messagesFor(DEFAULT_LANGUAGE);
  let messages = ru;
  if (lang !== DEFAULT_LANGUAGE) {
    try {
      messages = await messagesFor(lang);
    } catch {
      lang = DEFAULT_LANGUAGE; // файл перевода не загрузился — работаем на русском
    }
  }
  t = createTranslator(messages, ru, lang);
  html.lang = lang;

  const catalog = await loadCatalog(new URL('data/', base));
  const enclosures = indexById(catalog.enclosures);
  const devices = indexById(catalog.devices);
  const store = createLocalStore(storage, enclosures, devices);

  const hash = window.location.hash;
  if (hash) {
    // Убираем код щита из адреса, чтобы перезагрузка не открывала ссылку повторно
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  const restored = restoreProject({
    hash,
    localText: store.loadText(),
    enclosures,
    devices,
    confirmLink: () => window.confirm(t('project.confirmLink')),
    catalog: { carriersById: indexById(catalog.terminalCarriers ?? []), insertsById: indexById(catalog.terminalInserts ?? []) },
  });
  // Прежняя версия откладывается до того, как автосохранение её перезапишет
  if (restored.backupText !== null) store.saveBackup(restored.backupText);

  const app = mountApp(root, {
    catalog,
    t,
    store,
    initialBoard: restored.board,
    initialStatus: restored.notices.map(({ key, params }) => t(key, params)).join(' '),
    // Копия, отложенная сейчас или раньше: её можно скачать, пока пользователь её не удалит
    backupText: restored.backupText ?? store.loadBackup(),
  });

  const switchLanguage = async (next) => {
    if (next === lang) return;
    let messages;
    try {
      messages = await messagesFor(next);
    } catch {
      app.setStatus(t('language.loadError')); // остаёмся на текущем языке
      return;
    }
    lang = next;
    saveLanguage(storage, lang);
    html.lang = lang;
    t = createTranslator(messages, ru, lang);
    app.setTranslator(t);
    renderLanguageSwitcher(lang, t, switchLanguage);
  };
  renderLanguageSwitcher(lang, t, switchLanguage);
  html.dataset.appState = 'ready';
} catch (err) {
  console.error(err);
  const message = document.createElement('p');
  message.className = 'load-error';
  message.textContent = t('app.error.load');
  root.replaceChildren(message);
  html.dataset.appState = 'error';
}
