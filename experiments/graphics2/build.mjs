// Проба «Графики 2.0»: node experiments/graphics2/build.mjs → dist/graphics2.html (открыть в браузере).
// Кадры: window.__frame(1) — герой крупно, (2) — со спины на остров, (3) — с пляжа на гору.
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const r = await build({ entryPoints: [join(here, 'demo.js')], bundle: true, format: 'iife', write: false, minify: true, logLevel: 'error' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
mkdirSync(join(here, '../../dist'), { recursive: true });
writeFileSync(join(here, '../../dist/graphics2.html'), `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Графика 2.0</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#e9eee4}canvas{display:block}</style></head><body><script>${js}</script></body></html>`);
console.log('dist/graphics2.html');
