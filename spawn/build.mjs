// Сборка пробной сцены «Высотное поселение» (первая локация, этап 1 — окружение).
// Запуск из корня: node spawn/build.mjs → dist/spawn.html (открыть в браузере) и dist/spawn-artifact.html (для claude.ai).
// Игру 0.4 (src/main.js, APK) не меняет; модули src/ (gfx, models, fire, hero, noise) — используются как есть.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';

const MIME = { glb: 'model/gltf-binary', jpg: 'image/jpeg', woff2: 'font/woff2' };
const enc = (dir) => readdirSync(dir).filter((f) => MIME[f.split('.').pop()])
  .map((f) => `  ${JSON.stringify(f)}: "data:${MIME[f.split('.').pop()]};base64,${readFileSync(`${dir}/${f}`).toString('base64')}"`);
// ассеты игры (модели Kenney, текстуры скал) — как в build.mjs
const lines = [];
for (const dir of ['models', 'textures', 'fonts']) lines.push(...enc(`assets/${dir}`));
const fonts = JSON.parse(readFileSync('assets/fonts/fonts.json', 'utf8'));
writeFileSync('src/assets.gen.js', `// создаётся build.mjs — не править руками\nexport const ASSETS = {\n${lines.join(',\n')}\n};\nexport const FONTS = ${JSON.stringify(fonts)};\n`);
writeFileSync('spawn/src/assets.gen.js', `// создаётся spawn/build.mjs\nexport const SPAWN_ASSETS = {\n${enc('spawn/assets').join(',\n')}\n};\n`);

const r = await build({ absWorkingDir: process.cwd(), entryPoints: ['spawn/src/main.js'], bundle: true, format: 'iife', target: ['es2020'],
  write: false, legalComments: 'none', minify: !process.argv.includes('--dev'), logLevel: 'warning' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const page = readFileSync('spawn/page.html', 'utf8').replace('<!--GAME-->', () => `<script>${js}</script>`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/spawn-artifact.html', page);
writeFileSync('dist/spawn.html', `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"><title>Giver — Высотное поселение</title></head><body>${page}</body></html>`);
console.log(`spawn.html: ${(page.length / 1024 / 1024).toFixed(2)} МБ`);
