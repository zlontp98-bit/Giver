#!/usr/bin/env python3
"""Импорт моделей Quaternius «Stylized Nature MegaKit» (CC0) для телефона.

python3 tools/import-quaternius.py <папка после tools/simplify-quaternius.mjs>

Каждая модель → assets/models/q-<Имя>.glb: геометрия внутри, а текстуры — общие файлы
assets/textures/q-*.png|jpg (по 256 px вместо 2048; карты нормалей выкинуты — на телефоне дорого).
В игре загрузчик подставляет текстуры из ASSETS по имени (render/models.js, приставка q-).
"""
import json, struct, sys, os
from PIL import Image

SRC = sys.argv[1]
OUT_M, OUT_T = 'assets/models', 'assets/textures'

# какие модели берём и как называются общие текстуры
MODELS = [
    'CommonTree_3', 'CommonTree_5', 'Pine_5', 'TwistedTree_1',
    'CommonTree_3_far', 'CommonTree_5_far', 'Pine_5_far', 'TwistedTree_1_far',
    'Bush_Common_Flowers', 'Grass_Common_Short', 'Fern_1', 'Flower_3_Single', 'Flower_4_Single', 'Clover_1',
    'Rock_Medium_2', 'Rock_Medium_3', 'Pebble_Round_1', 'Pebble_Round_3',
]
# какую долю листвы оставить (пластинки крон сильно перекрываются — 60% хватает, а треугольников меньше)
THIN = {'CommonTree_3': 0.6, 'CommonTree_5': 0.6, 'Pine_5': 0.7, 'TwistedTree_1': 0.5, 'Bush_Common_Flowers': 0.4,
        'CommonTree_3_far': 0.28, 'CommonTree_5_far': 0.28, 'Pine_5_far': 0.35, 'TwistedTree_1_far': 0.25}
TEX = {  # исходник → (имя в игре, размер, jpg?)
    'Bark_NormalTree.png': ('q-bark.jpg', 256, True),
    'Bark_DeadTree.png': ('q-bark-dead.jpg', 256, True),
    'Bark_TwistedTree.png': ('q-bark-twisted.jpg', 256, True),
    'Leaves_NormalTree_C.png': ('q-leaves-tree.png', 256, False),
    'Leaf_Pine_C.png': ('q-leaves-pine.png', 256, False),
    'Leaves_TwistedTree_C.png': ('q-leaves-twisted.png', 256, False),
    'Leaves.png': ('q-leaves.png', 512, False),
    'Flowers.png': ('q-flowers.png', 256, False),
    'Grass.png': ('q-grass.png', 128, False),
    'Mushrooms.png': ('q-mushrooms.jpg', 256, True),
    'Rocks_Diffuse.png': ('q-rocks.jpg', 256, True),
    'PathRocks_Diffuse.png': ('q-pathrocks.jpg', 256, True),
}

def convert_texture(src_name):
    name, size, jpg = TEX[src_name]
    out = os.path.join(OUT_T, name)
    if not os.path.exists(out):
        im = Image.open(os.path.join(SRC, src_name))
        im = im.resize((size, size), Image.LANCZOS)
        if jpg:
            im.convert('RGB').save(out, quality=86, optimize=True)
        else:
            im.save(out, optimize=True)
    return name

def pad4(b, fill=b' '):
    return b + fill * ((4 - len(b) % 4) % 4)

for m in MODELS:
    g = json.load(open(os.path.join(SRC, m + '.gltf')))
    bin_data = open(os.path.join(SRC, g['buffers'][0]['uri']), 'rb').read()
    # без карт нормалей и прочего — только цвет
    for mat in g.get('materials', []):
        mat.pop('normalTexture', None)
        mat.pop('occlusionTexture', None)
        pbr = mat.get('pbrMetallicRoughness', {})
        pbr.pop('metallicRoughnessTexture', None)
    used = set()
    for mat in g.get('materials', []):
        t = mat.get('pbrMetallicRoughness', {}).get('baseColorTexture')
        if t is not None:
            used.add(g['textures'][t['index']]['source'])
    for i, img in enumerate(g.get('images', [])):
        src = os.path.basename(img['uri'])
        if i in used:
            if src not in TEX:
                raise SystemExit(f'{m}: нет правила для текстуры {src}')
            img['uri'] = convert_texture(src)
            img['name'] = img['uri']                 # по имени игра делит одну текстуру между моделями
        else:
            img['uri'] = 'q-unused.png'          # не загружается: на неё не ссылается ни один материал
        img.pop('mimeType', None)
    # пересобрать буфер: позиции/нормали/UV как есть, цвет вершин (затенение у ствола и травы) — в байтах,
    # у листвы он белый — выкидываем
    out_bin, views, accs = bytearray(), [], []
    def put(raw, target=None):
        while len(out_bin) % 4: out_bin.append(0)
        views.append({'buffer': 0, 'byteOffset': len(out_bin), 'byteLength': len(raw), **({'target': target} if target else {})})
        out_bin.extend(raw)
        return len(views) - 1
    def read(ai):
        a = g['accessors'][ai]; bv = g['bufferViews'][a['bufferView']]
        comps = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        csz = {5126: 4, 5123: 2, 5125: 4, 5121: 1}[a['componentType']]
        stride = bv.get('byteStride') or comps * csz
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        return a, comps, csz, stride, off
    def copy_acc(ai, target=None):
        a, comps, csz, stride, off = read(ai)
        raw = b''.join(bin_data[off + i * stride: off + i * stride + comps * csz] for i in range(a['count']))
        na = {k: v for k, v in a.items() if k not in ('bufferView', 'byteOffset')}
        na['bufferView'] = put(raw, target)
        accs.append(na)
        return len(accs) - 1
    for me in g['meshes']:
        for pr in me['primitives']:
            at = pr['attributes']
            col = at.pop('COLOR_0', None)
            na = {}
            for k in ('POSITION', 'NORMAL', 'TEXCOORD_0'):
                if k in at: na[k] = copy_acc(at[k], 34962)
            if col is not None:
                a, comps, csz, stride, off = read(col)
                vals = []
                for i in range(a['count']):
                    v = struct.unpack_from('<%d%s' % (comps, {4: 'f', 2: 'H', 1: 'B'}[csz]), bin_data, off + i * stride)[:3]
                    if csz == 2: v = tuple(x / 65535 for x in v)
                    if csz == 1: v = tuple(x / 255 for x in v)
                    vals.append(v)
                if min(min(v) for v in vals) < 0.98:
                    raw = bytes(max(0, min(255, round(x * 255))) for v in vals for x in v)
                    accs.append({'componentType': 5121, 'normalized': True, 'count': a['count'], 'type': 'VEC3', 'bufferView': put(raw, 34962)})
                    na['COLOR_0'] = len(accs) - 1
            pr['attributes'] = na
            if 'indices' in pr:
                mname = g['materials'][pr['material']].get('name', '')
                keep = THIN.get(m, 1.0) if 'Leaves' in mname or 'Leaf' in mname else 1.0
                if keep < 1.0:
                    # проредить листву: выкинуть часть пластинок (по 2 треугольника), равномерно по кроне
                    a, comps, csz, stride, off = read(pr['indices'])
                    fmt = '<H' if csz == 2 else '<I'
                    idx = [struct.unpack_from(fmt, bin_data, off + i * csz)[0] for i in range(a['count'])]
                    out_idx, acc = [], 0.0
                    for q in range(0, len(idx) - 5, 6):
                        acc += keep
                        if acc >= 1.0: acc -= 1.0; out_idx += idx[q:q + 6]
                    raw = b''.join(struct.pack(fmt, v) for v in out_idx)
                    na2 = {k: v for k, v in a.items() if k not in ('bufferView', 'byteOffset', 'count', 'min', 'max')}
                    na2['count'] = len(out_idx); na2['bufferView'] = put(raw, 34963)
                    accs.append(na2); pr['indices'] = len(accs) - 1
                else:
                    pr['indices'] = copy_acc(pr['indices'], 34963)
    g['accessors'], g['bufferViews'] = accs, views
    bin_data = bytes(out_bin)
    g['buffers'] = [{'byteLength': len(bin_data)}]
    js = pad4(json.dumps(g, separators=(',', ':')).encode())
    bn = pad4(bin_data, b'\0')
    total = 12 + 8 + len(js) + 8 + len(bn)
    out = struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(bn), 0x004E4942) + bn
    open(os.path.join(OUT_M, f'q-{m}.glb'), 'wb').write(out)
    print(f'q-{m}.glb', len(out) // 1024, 'КБ')
