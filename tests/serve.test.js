import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve, sep } from 'node:path';
import { createReadStream } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';

import { resolveRequestPath, contentType, createSiteServer } from '../tools/serve.js';

const ROOT = resolve('/srv/site');

describe('resolveRequestPath', () => {
  test('корень и папки ведут на index.html', () => {
    assert.equal(resolveRequestPath(ROOT, '/'), join(ROOT, 'index.html'));
    assert.equal(resolveRequestPath(ROOT, '/docs/'), join(ROOT, 'docs', 'index.html'));
  });

  test('обычный файл, query и hash отбрасываются', () => {
    assert.equal(resolveRequestPath(ROOT, '/css/style.css?v=1#x'), join(ROOT, 'css', 'style.css'));
  });

  test('закодированные символы раскодируются', () => {
    assert.equal(resolveRequestPath(ROOT, '/data/%D1%89%D0%B8%D1%82.json'), join(ROOT, 'data', 'щит.json'));
  });

  test('выход за пределы корня запрещён', () => {
    for (const bad of [
      '/../AGENTS.md',
      '/../../etc/passwd',
      '/css/../../AGENTS.md',
      '/%2e%2e/AGENTS.md',
      '/%2e%2e%2fAGENTS.md',
      '/..%5cAGENTS.md',
    ]) {
      const result = resolveRequestPath(ROOT, bad);
      assert.ok(
        result === null || result === ROOT || result.startsWith(ROOT + sep),
        `путь ${bad} вышел за корень: ${result}`,
      );
    }
  });

  test('некорректный ввод даёт null', () => {
    assert.equal(resolveRequestPath(ROOT, 'index.html'), null);
    assert.equal(resolveRequestPath(ROOT, undefined), null);
    assert.equal(resolveRequestPath(ROOT, '/%E0%A4%A'), null);
    assert.equal(resolveRequestPath(ROOT, '/a%00.html'), null);
    assert.equal(resolveRequestPath(ROOT, '/a\\b.html'), null);
  });
});

describe('contentType', () => {
  test('известные и неизвестные расширения', () => {
    assert.equal(contentType('index.html'), 'text/html; charset=utf-8');
    assert.equal(contentType('main.JS'), 'text/javascript; charset=utf-8');
    assert.equal(contentType('catalog.json'), 'application/json; charset=utf-8');
    assert.equal(contentType('file.bin'), 'application/octet-stream');
  });
});

describe('createSiteServer', () => {
  let dir;
  let server;
  let base;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dinboard-serve-'));
    await mkdir(join(dir, 'sub'));
    await writeFile(join(dir, 'index.html'), '<!doctype html><title>t</title>');
    await writeFile(join(dir, 'sub', 'index.html'), 'sub');
    server = createSiteServer(dir);
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((ok) => server.close(ok));
    await rm(dir, { recursive: true, force: true });
  });

  test('отдаёт index.html с правильным типом', async () => {
    const res = await fetch(base + '/');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(await res.text(), /<title>t<\/title>/);
  });

  test('несуществующий файл: 404', async () => {
    const res = await fetch(base + '/nope.js');
    assert.equal(res.status, 404);
    await res.body?.cancel();
  });

  test('папка без слеша: редирект на путь со слешем, без выхода на чужой хост', async () => {
    const res = await fetch(base + '/sub', { redirect: 'manual' });
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), '/sub/');

    const tricky = await fetch(base + '//sub', { redirect: 'manual' });
    assert.equal(tricky.status, 301);
    assert.equal(tricky.headers.get('location'), '/sub/');
  });

  test('POST запрещён', async () => {
    const res = await fetch(base + '/', { method: 'POST' });
    assert.equal(res.status, 405);
    await res.body?.cancel();
  });
});

describe('createSiteServer: файл есть, но не открывается', () => {
  let dir;
  let server;
  let base;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dinboard-serve-'));
    await writeFile(join(dir, 'index.html'), 'ok');
    await writeFile(join(dir, 'locked.json'), '{}');
    // Имитация файла, заблокированного другой программой (EBUSY на Windows)
    const openFile = (filePath) => {
      if (!filePath.endsWith('locked.json')) return createReadStream(filePath);
      const stream = new Readable({ read() {} });
      process.nextTick(() =>
        stream.destroy(Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' })),
      );
      return stream;
    };
    server = createSiteServer(dir, { openFile });
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((ok) => server.close(ok));
    await rm(dir, { recursive: true, force: true });
  });

  test('отвечает 500, а сервер продолжает работать', async () => {
    const res = await fetch(base + '/locked.json');
    assert.equal(res.status, 500);
    await res.body?.cancel();

    const next = await fetch(base + '/');
    assert.equal(next.status, 200);
    assert.equal(await next.text(), 'ok');
  });
});
