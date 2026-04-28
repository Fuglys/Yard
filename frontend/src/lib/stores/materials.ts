// Materials uit dagstart_db (gecached lokaal)
import { db, getKV, setKV } from '../db/dexie';

type Listener<T> = (value: T) => void;
function createStore<T>(initial: T) {
  let val = initial;
  const subs = new Set<Listener<T>>();
  return {
    get: () => val,
    set: (v: T) => { val = v; subs.forEach((s) => s(val)); },
    subscribe: (s: Listener<T>) => { subs.add(s); s(val); return () => subs.delete(s); },
  };
}

export interface Material { id: number; name: string; is_test?: boolean }

export const materialsStore = createStore<Material[]>([]);

export async function loadMaterials() {
  // Eerst uit cache laden voor snelle UI
  const cached = await getKV<Material[]>('materials', []);
  if (cached.length) materialsStore.set(cached);

  // Dan vers ophalen vanaf server
  try {
    const res = await fetch('/api/materials');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const fresh: Material[] = await res.json();
    materialsStore.set(fresh);
    await setKV('materials', fresh);
  } catch (err) {
    console.warn('Materials fetch failed, using cache:', err);
  }
}
