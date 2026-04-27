// Bridge tussen onze custom stores en Svelte 5 $state — gebruik in components als:
//   const areas = useStore(areasStore);
import { onDestroy } from 'svelte';

export interface ReadableStore<T> {
  get(): T;
  subscribe(fn: (v: T) => void): () => void;
}

export function useStore<T>(store: ReadableStore<T>) {
  let value = $state(store.get());
  const unsub = store.subscribe((v) => { value = v; });
  onDestroy(() => unsub());
  return {
    get value() { return value; },
  };
}
