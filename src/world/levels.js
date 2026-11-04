// Ярусы Бездны. Новый ярус = новый файл-«план» (как level1.js) и строка здесь: движок (SDF, запекание,
// физика, сущности, сохранение) общий. Каждый ярус задаёт своё зерно, функцию build(W) → план L и глубину.
// Пока в игре один ярус; переход между ярусами (решётка на дне) появится вместе со вторым.
import { buildLevel1, LEVEL_SEED } from './level1.js';
import { PIT_DEPTH } from './sdf.js';

export const LEVELS = {
  // демоверсия 0.5: только верх первого яруса (см. L.demo). Проверки всего яруса ставят window.__giverFull = true
  layer1: { id: 'layer1', name: 'Первый ярус', seed: LEVEL_SEED, depth: PIT_DEPTH, build: (W) => buildLevel1(W, { demo: !globalThis.__giverFull }) },
};
export const START_LEVEL = 'layer1';
