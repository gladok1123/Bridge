#!/usr/bin/env node
/**
 * check-all.mjs — все проверки Bridge одной командой:
 * сборка проекта, логика без браузера, свой релей и сайт в поддельном браузере.
 *
 * Работает и на Windows: сборка запускается напрямую через Node и локальный
 * Next, без «npx» (в Windows это отдельный файл npx.cmd и обычный вызов падает).
 *
 * Запуск:  node tools/check-all.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE = process.execPath;
const nextBin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');

const suites = [
  ['Сборка приложения (next build)', NODE, [nextBin, 'build']],
  ['Свой релей и логика', NODE, [path.join(ROOT, 'tools', 'unit.mjs')]],
  ['Сайт в поддельном браузере', NODE, [path.join(ROOT, 'tools', 'smoke.mjs')]],
];

let bad = 0;
const results = [];

/* ── предварительная проверка: всё ли на месте ─────────────────────────── */
if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
  console.log('\n  ⛔ Нет папки node_modules — сначала выполните:  npm install\n');
  process.exit(2);
}
if (!fs.existsSync(nextBin)) {
  console.log('\n  ⛔ Не найден Next.js в node_modules. Выполните:  npm install\n');
  process.exit(2);
}

for (const [title, cmd, args] of suites) {
  process.stdout.write('\n────────────────────────────────────────────\n  ' + title + '\n');
  let out = '';
  let code = 0;
  try {
    out = execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  } catch (e) {
    code = e.status || 1;
    out = String(e.stdout || '') + String(e.stderr || '');
    if (out && !/\n$/.test(out)) out += '\n';
  }
  const lines = out.trim().split('\n');
  /* при удаче показываем только хвост, при ошибке — заметный кусок с причиной */
  const tail = code ? lines.slice(-24) : lines.slice(-4);
  console.log(tail.map((l) => (l.length > 160 ? l.slice(0, 160) + '…' : l)).join('\n'));

  const totals = [...out.matchAll(/ИТОГ[^\n]*?(\d+)\s*✅\s*\/\s*(\d+)\s*❌/g)].pop();
  const okCount = totals ? Number(totals[1]) : (out.match(/✅/g) || []).length;
  const failed = totals ? Number(totals[2]) : (out.match(/❌/g) || []).length;
  if (failed || code) bad++;
  results.push({ title, ok: okCount, failed, code });
}

console.log('\n════════════════════════════════════════════');
console.log('  ИТОГ ПО ПРОЕКТУ BRIDGE');
results.forEach((r) => {
  const mark = r.failed || r.code ? '❌' : '✅';
  console.log('  ' + mark + ' ' + r.title + (r.ok ? ' — ' + r.ok + ' проверок' : ''));
});
console.log('  ' + (bad ? '❌' : '✅') + ' наборов с ошибками: ' + bad);
if (bad) {
  console.log('\n  Если ошибка в проверках сайта — убедитесь, что выполнен «npm install»:');
  console.log('  проверкам нужны esbuild и jsdom (они лежат в devDependencies).');
}
console.log('');
process.exit(bad ? 1 : 0);
