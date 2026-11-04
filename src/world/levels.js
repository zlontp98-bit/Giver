// Ярусы Бездны. Новый ярус = новый файл-«план» (как level1.js) и строка здесь: движок (SDF, запекание,
// физика, сущности, сохранение) общий. Каждый ярус задаёт своё зерно, функцию build(W) → план L и глубину.
// Пока в игре один ярус; переход между ярусами (решётка на дне) появится вместе со вторым.
import { buildLevel1, LEVEL_SEED } from './level1.js';
import { PIT_DEPTH } from './sdf.js';

export const LEVELS = {
  layer1: { id: 'layer1', name: 'Первый ярус', seed: LEVEL_SEED, depth: PIT_DEPTH, build: buildLevel1 },
};
export const START_LEVEL = 'layer1';
