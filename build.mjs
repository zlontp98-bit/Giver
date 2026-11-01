// Сборка игры: src/*.js + three.js → один файл game.js (без модулей, чтобы работал из file:// в WebView).
// Результат:
//   android/app/src/main/assets/web/index.html + game.js  — то, что попадает в APK
//   dist/giver.html                                       — всё в одном файле (проверка в браузере, артефакт)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const watchless = process.argv.includes('--dev') ? { minify: false, sourcemap: 'inline' } : { minify: true };

const result = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: ['es2019'],
  write: false,
  legalComments: 'none',
  ...watchless,
});
const js = result.outputFiles[0].text;
const html = readFileSync('web/index.html', 'utf8');

const assets = 'android/app/src/main/assets/web';
mkdirSync(assets, { recursive: true });
writeFileSync(`${assets}/game.js`, js);
writeFileSync(`${assets}/index.html`, html.replace('<!--GAME-->', '<script src="game.js"></script>'));

mkdirSync('dist', { recursive: true });
// </script> внутри кода сломал бы встраивание — экранируем
const inline = js.replace(/<\/script/gi, '<\\/script');
writeFileSync('dist/giver.html', html.replace('<!--GAME-->', () => `<script>${inline}</script>`));

console.log(`game.js: ${(js.length / 1024).toFixed(0)} КБ`);
