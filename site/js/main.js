// Точка входа: загружает каталог и переводы, запускает интерфейс конструктора.

import { loadCatalog } from './catalog.js';
import { loadMessages, createTranslator, DEFAULT_LANGUAGE } from './i18n.js';
import { mountApp } from './ui.js';

const root = document.getElementById('app');
const base = document.baseURI;
const html = document.documentElement;

let t = createTranslator({});
try {
  const messages = await loadMessages(DEFAULT_LANGUAGE, new URL('i18n/', base));
  t = createTranslator(messages);
  html.lang = DEFAULT_LANGUAGE;
  const catalog = await loadCatalog(new URL('data/', base));
  mountApp(root, { catalog, t });
  html.dataset.appState = 'ready';
} catch (err) {
  console.error(err);
  const message = document.createElement('p');
  message.className = 'load-error';
  message.textContent = t('app.error.load');
  root.replaceChildren(message);
  html.dataset.appState = 'error';
}
