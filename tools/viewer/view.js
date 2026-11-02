// Просмотр запечённого мира без игры: камера ставится из скрипта (tools/viewer/shots.cjs).
import * as THREE from 'three';
import { createGfx } from '../../src/render/gfx.js';
import { buildTerrain, worldMaterial } from '../../src/world/terrain.js';

const q = new URLSearchParams(location.search).get('q') || 'low';
const gfx = createGfx();
gfx.materialFactory = worldMaterial;
const { group, meshes } = buildTerrain(worldMaterial(0));
gfx.scene.add(group);
gfx.rockMeshes.push(...meshes);
gfx.setQuality(q);
gfx.scene.fog.density = 0.0016;
window.__view = {
  gfx, THREE,
  look(px, py, pz, tx, ty, tz, fogD) {
    gfx.camera.position.set(px, py, pz);
    gfx.camera.lookAt(tx, ty, tz);
    if (fogD !== undefined) gfx.scene.fog.density = fogD;
    gfx.follow(new THREE.Vector3(px, py, pz));
    gfx.render(0.016);
  },
};
document.body.classList.add('ready');
