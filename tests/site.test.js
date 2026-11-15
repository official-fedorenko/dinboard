import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';

import { SITE_ROOT } from '../tools/serve.js';

const html = await readFile(join(SITE_ROOT, 'index.html'), 'utf8');

test('index.html: язык, кодировка, viewport', () => {
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<html lang="ru">/);
  assert.match(html, /<meta charset="utf-8">/i);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
});

test('index.html подключает main.js как ES-модуль', () => {
  assert.match(html, /<script type="module" src="js\/main\.js"><\/script>/);
});

test('все локальные ссылки из index.html указывают на существующие файлы', async () => {
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  const local = refs.filter((ref) => !/^(?:[a-z]+:)?\/\//i.test(ref) && !ref.startsWith('#'));
  assert.ok(local.length > 0, 'нет локальных ссылок');
  for (const ref of local) {
    // Пути должны быть относительными: на GitHub Pages сайт живёт в подпапке /dinboard/
    assert.ok(!ref.startsWith('/'), `абсолютный путь сломается на GitHub Pages: ${ref}`);
    await access(join(SITE_ROOT, ref));
  }
});
