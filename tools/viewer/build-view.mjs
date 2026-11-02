import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
const r = await build({ entryPoints: ['tools/viewer/view.js'], bundle: true, format: 'iife', write: false, minify: true, logLevel: 'warning' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
writeFileSync('dist/view.html', `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden}canvas{display:block}</style></head><body><script>${js}</script></body></html>`);
console.log('dist/view.html', (js.length / 1048576).toFixed(2), 'MB');
