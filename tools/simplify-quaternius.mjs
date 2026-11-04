// Шаг перед tools/import-quaternius.py: упростить модели Quaternius для телефона (meshoptimizer).
//   node tools/simplify-quaternius.mjs <kit/glTF> <папка-результат>
// Стволы деревьев (кора) — в ~3 раза меньше треугольников, листва — как есть (её прореживает импорт).
// Для деревьев ещё делается дальняя копия «<Имя>_far»: всё сильно упрощено — ею рисуются деревья вдали.
import { NodeIO } from '@gltf-transform/core';
import { compactPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { mkdirSync, copyFileSync, readdirSync } from 'node:fs';

const [src, dst] = process.argv.slice(2);
mkdirSync(dst, { recursive: true });
for (const f of readdirSync(src)) if (f.endsWith('.png')) copyFileSync(`${src}/${f}`, `${dst}/${f}`);
await MeshoptSimplifier.ready;
const io = new NodeIO();
const TREES = ['CommonTree_3', 'CommonTree_5', 'Pine_5', 'TwistedTree_1'];
const ALL = readdirSync(src).filter((f) => f.endsWith('.gltf')).map((f) => f.replace('.gltf', ''));

for (const name of ALL) {
  const doc = await io.read(`${src}/${name}.gltf`);
  if (TREES.includes(name)) {
    // кора: оставить ~35% треугольников (листву не трогаем — см. barkOnly)
    await barkOnly(doc, 0.35, 0.02);
    await io.write(`${dst}/${name}.gltf`, doc);
    // дальняя копия: кора 10%, листва — половина пластинок (импорт прорежет ещё)
    const far = await io.read(`${src}/${name}.gltf`);
    await barkOnly(far, 0.1, 0.08);
    for (const b of far.getRoot().listBuffers()) b.setURI(`${name}_far.bin`);     // иначе перезапишет .bin ближней
    await io.write(`${dst}/${name}_far.gltf`, far);
  } else {
    await io.write(`${dst}/${name}.gltf`, doc);
  }
}

// упростить кору, а листву (пластинки с альфой) не трогать — иначе кроны «тают». Швы текстуры разрывают сетку,
// и обычное упрощение почти ничего не может — поэтому склеиваем вершины только по положению, упрощаем,
// а у треугольников оставляем исходные вершины (с их UV): у коры на швах это почти не видно.
async function barkOnly(doc, ratio, error) {
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    if (/Lea/.test(prim.getMaterial()?.getName() || '')) continue;
    const pos = prim.getAttribute('POSITION').getArray(), ia = prim.getIndices();
    const idx = Uint32Array.from(ia.getArray());
    const key = new Map(), rep = [], remap = new Uint32Array(pos.length / 3), upos = [];
    for (let v = 0; v < pos.length / 3; v++) {
      const k = `${pos[v * 3].toFixed(4)},${pos[v * 3 + 1].toFixed(4)},${pos[v * 3 + 2].toFixed(4)}`;
      if (!key.has(k)) { key.set(k, rep.length); rep.push(v); upos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); }
      remap[v] = key.get(k);
    }
    const uidx = idx.map((v) => remap[v]);
    const target = Math.max(3, Math.floor((uidx.length * ratio) / 3) * 3);
    const [out] = MeshoptSimplifier.simplify(uidx, new Float32Array(upos), 3, target, error, ['ErrorAbsolute'].slice(0, 0));
    const back = new Uint32Array(out.length);
    for (let i = 0; i < out.length; i++) back[i] = rep[out[i]];
    ia.setArray(pos.length / 3 > 65535 ? back : Uint16Array.from(back));
    compactPrimitive(prim);
  }
}
console.log('готово:', ALL.length, 'моделей →', dst);
