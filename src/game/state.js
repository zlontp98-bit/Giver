// Состояние игры — только данные, отдельно от картинки: что лежит в рюкзаке, где герой, что собрано,
// что построено, какие рюкзаки остались на местах гибели. Его сохраняем на телефоне целиком; потом его же
// можно будет передавать по сети. Картинка (модели, огоньки) только показывает это состояние.
export const STATE_FORMAT = 1;

export function freshState(level) {
  return {
    v: STATE_FORMAT,
    level,
    player: { pos: null, health: 100, stamina: 100, checkpoint: null, campName: 'посёлок' },
    inv: {},                // ресурсы и вещи: { wood: 3, ore: 1, pickaxe: 1 }
    gear: {},               // надетое и выученное: { pickaxe: true, spikes: true }
    entities: {},           // изменения сущностей уровня ({ id: { taken: true } }) и свои сущности ({ dynamic: true, ... })
    time: 0,                // сколько сыграно, с
  };
}

// старое сохранение 0.5-a3 (progress: { finds, notes }) → состояние
export function stateFromSave(data, level) {
  const st = data.state && data.state.v === STATE_FORMAT ? data.state : freshState(level);
  const p = data.progress;
  if (p && !st.migratedProgress) {
    for (const id of p.finds || []) st.entities[`find:${id}`] = { ...(st.entities[`find:${id}`] || {}), taken: true };
    for (const id of p.notes || []) st.entities[`note:${id}`] = { ...(st.entities[`note:${id}`] || {}), read: true };
    st.migratedProgress = true;
  }
  return st;
}
