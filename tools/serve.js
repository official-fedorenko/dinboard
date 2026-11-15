// Локальный сервер для разработки: отдаёт статические файлы из папки site/.
// Только для локальной проверки, на GitHub Pages не используется.
// Запуск: node tools/serve.js  (порт можно задать переменной PORT)

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream';
import { extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE_ROOT = resolve(fileURLToPath(new URL('../site', import.meta.url)));

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Тип содержимого по расширению файла. */
export function contentType(filePath) {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Превращает путь из URL в абсолютный путь к файлу внутри root.
 * Возвращает null, если путь некорректен или выходит за пределы root.
 * Путь, оканчивающийся на "/", указывает на index.html в этой папке.
 */
export function resolveRequestPath(root, urlPath) {
  if (typeof urlPath !== 'string' || !urlPath.startsWith('/')) return null;

  const pathname = urlPath.split(/[?#]/, 1)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;

  const relative = decoded.endsWith('/') ? decoded + 'index.html' : decoded;
  const rootAbs = resolve(root);
  const target = resolve(rootAbs, '.' + normalize(relative));

  if (target !== rootAbs && !target.startsWith(rootAbs + sep)) return null;
  return target;
}

/**
 * Создаёт HTTP-сервер, отдающий файлы из root (без запуска).
 * options.openFile — функция открытия файла на чтение (подменяется в тестах).
 */
export function createSiteServer(root = SITE_ROOT, { openFile = createReadStream } = {}) {
  return createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }

    const filePath = resolveRequestPath(root, req.url);
    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Bad request');
      return;
    }

    try {
      const info = await stat(filePath);
      if (info.isDirectory()) {
        // /folder без слеша: отправляем на /folder/, как это делает GitHub Pages.
        // Ведущие слеши схлопываем, чтобы "//host" не стал внешним адресом.
        const pathname = req.url.split(/[?#]/, 1)[0].replace(/^\/+/, '/');
        res.writeHead(301, { Location: pathname + '/' }).end();
        return;
      }
      const headers = {
        'Content-Type': contentType(filePath),
        'Content-Length': info.size,
        'Cache-Control': 'no-store',
      };
      if (req.method === 'HEAD') {
        res.writeHead(200, headers).end();
        return;
      }
      // Заголовки отправляем только после того, как файл открылся:
      // если файл заблокирован другой программой (EBUSY), отвечаем 500, а не падаем.
      const stream = openFile(filePath);
      stream.once('error', () => {
        if (res.headersSent) res.destroy();
        else res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Cannot read file');
      });
      stream.once('ready', () => {
        res.writeHead(200, headers);
        pipeline(stream, res, () => {});
      });
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const port = Number(process.env.PORT) || 8080;
  const host = '127.0.0.1';
  const server = createSiteServer();
  server.listen(port, host, () => {
    console.log(`Dinboard: http://localhost:${port}/  (остановка: Ctrl+C)`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
