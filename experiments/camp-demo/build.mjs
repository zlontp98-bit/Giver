// Запуск из корня репозитория: node experiments/camp-demo/build.mjs (зависимости — в корневом package.json)
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
process.chdir(here);
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
const mime = { glb: 'model/gltf-binary', jpg: 'image/jpeg', png: 'image/png' };
const entries = readdirSync('assets').filter((f) => mime[f.split('.').pop()]).map((f) => `  ${JSON.stringify(f)}: "data:${mime[f.split('.').pop()]};base64,${readFileSync('assets/' + f).toString('base64')}"`);
writeFileSync('src/assets.gen.js', `export default {\n${entries.join(',\n')}\n};\n`);
const r = await build({ absWorkingDir: here, entryPoints: ['src/main.js'], bundle: true, format: 'iife', write: false, minify: true, logLevel: 'error', target: 'es2020' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const page = readFileSync('page.html', 'utf8').replace('<!--GAME-->', () => `<script>${js}</script>`);
mkdirSync('artifact', { recursive: true });
writeFileSync('artifact/camp.html', page);   // для claude.ai: каркас <html> добавит сам
writeFileSync('camp.html', `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${page}</body></html>`);
console.log('camp.html', (js.length / 1024 / 1024).toFixed(2), 'MB');
