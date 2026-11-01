# Откуда что взято (всё бесплатно, CC0 — можно использовать как угодно)

- Модели (`assets/*.glb`): Kenney, Nature Kit 2.1 — https://kenney.nl/assets/nature-kit (CC0, см. KENNEY-LICENSE.txt).
  Цвета в игре перекрашены под нашу палитру (`PALETTE` в src/main.js).
- Текстуры (`assets/*_diff.jpg`, `*_nor.jpg`, уменьшены до 512×512): Poly Haven — cliff_side, grass_ground,
  coast_sand_01, snow_02 (https://polyhaven.com, CC0).
- Эффекты: postprocessing (свечение, тонировка, виньетка, SMAA), n8ao (мягкие тени в щелях).
- Герой, костёр, светлячки, вода, небо, гора — свой код.

Сборка из корня репозитория: `npm ci && node experiments/camp-demo/build.mjs` → `camp.html` (для браузера) и `artifact/camp.html` (для claude.ai).
Артефакт: https://claude.ai/artifact/W9Nq2FqUtMEqtoVuEn9Vs4
