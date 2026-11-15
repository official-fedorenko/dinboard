// Точка входа: загружает каталог и переводы, восстанавливает щит
// (из ссылки или из хранилища браузера) и запускает интерфейс конструктора.

import { loadCatalog } from './catalog.js';
import { loadMessages, createTranslator, DEFAULT_LANGUAGE } from './i18n.js';
import { indexById } from './board.js';
import { createLocalStore, restoreProject } from './storage.js';
import { mountApp } from './ui.js';

const root = document.getElementById('app');
const base = document.baseURI;
const html = document.documentElement;

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined; // хранилище запрещено настройками браузера
  }
}

let t = createTranslator({});
try {
  const messages = await loadMessages(DEFAULT_LANGUAGE, new URL('i18n/', base));
  t = createTranslator(messages);
  html.lang = DEFAULT_LANGUAGE;
  const catalog = await loadCatalog(new URL('data/', base));
  const enclosures = indexById(catalog.enclosures);
  const devices = indexById(catalog.devices);
  const store = createLocalStore(browserStorage(), enclosures, devices);

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
  });
  // Прежняя версия откладывается до того, как автосохранение её перезапишет
  if (restored.backupText !== null) store.saveBackup(restored.backupText);

  mountApp(root, {
    catalog,
    t,
    store,
    initialBoard: restored.board,
    initialStatus: restored.notices.map(({ key, params }) => t(key, params)).join(' '),
    // Копия, отложенная сейчас или раньше: её можно скачать, пока пользователь её не удалит
    backupText: restored.backupText ?? store.loadBackup(),
  });
  html.dataset.appState = 'ready';
} catch (err) {
  console.error(err);
  const message = document.createElement('p');
  message.className = 'load-error';
  message.textContent = t('app.error.load');
  root.replaceChildren(message);
  html.dataset.appState = 'error';
}
