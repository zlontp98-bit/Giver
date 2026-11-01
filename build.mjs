// Сборка игры: src/*.js + three.js + эффекты + модели/текстуры/шрифты → один файл game.js
// (без модулей и без загрузки файлов — работает из file:// в WebView и офлайн).
// Результат:
//   android/app/src/main/assets/web/index.html + game.js  — то, что попадает в APK
//   dist/giver.html                                       — всё в одном файле (браузер, артефакт)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';

// 1. Ассеты → src/assets.gen.js (base64; GLB разбираем сами, без fetch)
const MIME = { glb: 'model/gltf-binary', jpg: 'image/jpeg', woff2: 'font/woff2' };
const lines = [];
for (const dir of ['models', 'textures', 'fonts']) {
  for (const f of readdirSync(`assets/${dir}`)) {
    const ext = f.split('.').pop();
    if (!MIME[ext]) continue;
    lines.push(`  ${JSON.stringify(f)}: "data:${MIME[ext]};base64,${readFileSync(`assets/${dir}/${f}`).toString('base64')}"`);
  }
}
const fonts = JSON.parse(readFileSync('assets/fonts/fonts.json', 'utf8'));
writeFileSync('src/assets.gen.js',
  `// создаётся build.mjs — не править руками\nexport const ASSETS = {\n${lines.join(',\n')}\n};\nexport const FONTS = ${JSON.stringify(fonts)};\n`);

// 2. Код
const dev = process.argv.includes('--dev');
const result = await build({
  absWorkingDir: process.cwd(),
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  write: false,
  legalComments: 'none',
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  logLevel: 'warning',
});
const js = result.outputFiles[0].text;
const html = readFileSync('web/index.html', 'utf8');

const assets = 'android/app/src/main/assets/web';
mkdirSync(assets, { recursive: true });
writeFileSync(`${assets}/game.js`, js);
writeFileSync(`${assets}/index.html`, html.replace('<!--GAME-->', '<script src="game.js"></script>'));

mkdirSync('dist', { recursive: true });
const inline = js.replace(/<\/script/gi, '<\\/script');
const single = html.replace('<!--GAME-->', () => `<script>${inline}</script>`);
writeFileSync('dist/giver.html', single);
// для артефакта на claude.ai: без своих <html>/<head>/<body> (каркас добавляет сервер)
const artifact = single
  .replace(/<!DOCTYPE html>\s*/i, '').replace(/<html[^>]*>\s*/i, '').replace(/<head>\s*/i, '')
  .replace(/<meta charset[^>]*>\s*/i, '').replace(/<meta name="viewport"[^>]*>\s*/i, '')
  .replace(/<\/head>\s*/i, '').replace(/<body>\s*/i, '').replace(/<\/body>\s*<\/html>\s*$/i, '');
writeFileSync('dist/giver-artifact.html', artifact);

console.log(`game.js: ${(js.length / 1024 / 1024).toFixed(2)} МБ`);
