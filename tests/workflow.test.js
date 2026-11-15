// Проверки workflow публикации. YAML-парсера нет (без зависимостей), поэтому проверяем текст.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');

test('все действия закреплены по SHA коммита', () => {
  const uses = [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map((m) => m[1]);
  assert.ok(uses.length > 0, 'в workflow нет ни одного uses:');
  for (const ref of uses) {
    assert.match(ref, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `не закреплено по SHA: ${ref}`);
  }
});

test('публикуется только папка site', () => {
  assert.match(workflow, /upload-pages-artifact@\S+[^\n]*\n\s+with:\n\s+path: site\s*$/m);
});

test('публикация идёт только после тестов и только из main', () => {
  assert.match(workflow, /^\s+needs: test$/m);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /^\s+- run: npm test$/m);
});

test('права по умолчанию только на чтение', () => {
  assert.match(workflow, /^permissions:\n\s+contents: read$/m);
});

test('у deploy есть contents: read (права job заменяют права workflow целиком)', () => {
  const deploy = workflow.slice(workflow.indexOf('\n  deploy:'));
  assert.match(deploy, /^    permissions:\n(?:      [\w-]+: \w+\n)*      contents: read\n/m);
});

test('checkout не сохраняет токен в .git/config', () => {
  const checkouts = workflow.match(/uses: actions\/checkout@\S+[^\n]*\n\s+with:\n\s+persist-credentials: false/g) ?? [];
  const total = workflow.match(/uses: actions\/checkout@/g)?.length ?? 0;
  assert.ok(total > 0);
  assert.equal(checkouts.length, total);
});

test('команда тестов — glob, а не папка (Node 22 не раскрывает папку в --test)', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.test, 'node --test "tests/**/*.test.js"');
});
