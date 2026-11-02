// Лист образцов моделей из набора Kenney: node tools/viewer/kits.mjs <папка GLB> <имя1,имя2,...> <файл.png>
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const [dir, list, out] = process.argv.slice(2);
const names = list.split(',');
const models = {};
for (const n of names) models[n] = readFileSync(path.join(dir, n + '.glb')).toString('base64');
const colormap = readFileSync(path.join(dir, 'Textures', 'colormap.png')).toString('base64');
const code = `
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const M = ${JSON.stringify(models)}, CM = 'data:image/png;base64,${colormap}';
const r = new THREE.WebGLRenderer({ antialias: true }); r.setSize(1400, 900); document.body.appendChild(r.domElement);
const s = new THREE.Scene(); s.background = new THREE.Color('#9fb4c4');
s.add(new THREE.HemisphereLight('#ffffff', '#666666', 2.2)); const d = new THREE.DirectionalLight('#fff', 2); d.position.set(3, 5, 4); s.add(d);
const cam = new THREE.PerspectiveCamera(35, 1400 / 900, 0.1, 200);
const mgr = new THREE.LoadingManager(); mgr.setURLModifier((u) => (u.endsWith('colormap.png') ? CM : u));
const L = new GLTFLoader(mgr); const names = Object.keys(M); const cols = Math.ceil(Math.sqrt(names.length * 1.5));
Promise.all(names.map((n, i) => L.parseAsync(Uint8Array.from(atob(M[n]), (c) => c.charCodeAt(0)).buffer, '').then((g) => {
  const x = (i % cols) * 1.8, z = Math.floor(i / cols) * 1.8; g.scene.position.set(x, 0, z); s.add(g.scene);
  const grid = new THREE.GridHelper(1, 2, 0x333333, 0x333333); grid.position.set(x, 0.001, z); s.add(grid);
  const ax = new THREE.AxesHelper(0.6); ax.position.set(x, 0.01, z); s.add(ax);
  const el = document.createElement('div'); el.textContent = n; el.style.cssText = 'position:absolute;font:12px sans-serif;color:#000;background:#fff8;padding:1px 3px';
  el.dataset.x = x; el.dataset.z = z; document.body.appendChild(el);
}))).then(() => {
  const rows = Math.ceil(names.length / cols); const cx = (cols - 1) * 0.9, cz = (rows - 1) * 0.9;
  cam.position.set(cx + 2, Math.max(cols, rows) * 1.6, cz + Math.max(cols, rows) * 1.9); cam.lookAt(cx, 0, cz);
  r.render(s, cam);
  for (const el of document.querySelectorAll('div')) { const v = new THREE.Vector3(+el.dataset.x - 0.5, 0, +el.dataset.z + 0.6).project(cam); el.style.left = ((v.x + 1) / 2 * 1400) + 'px'; el.style.top = ((1 - v.y) / 2 * 900) + 'px'; }
  window.done = true;
});`;
writeFileSync('/tmp/kits-entry.js', code);
const res = await build({ stdin: { contents: code, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', logLevel: 'error' });
writeFileSync('/tmp/kits.html', `<html><body style="margin:0">${''}<script>${res.outputFiles[0].text.replace(/<\/script/g, '<\\/script')}</script></body></html>`);
const { chromium } = require('playwright');
const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
await p.goto('file:///tmp/kits.html'); await p.waitForFunction(() => window.done, null, { timeout: 60000 });
await p.screenshot({ path: out }); await b.close(); console.log('лист:', out);
