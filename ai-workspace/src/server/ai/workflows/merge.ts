/**
 * Runs several async generators concurrently and yields their values as they arrive.
 * Returns each generator's return value, in input order.
 */
export async function* mergeGenerators<T, R>(gens: AsyncGenerator<T, R>[]): AsyncGenerator<T, R[]> {
  const results = new Array<R>(gens.length);
  const pending = new Map<number, Promise<{ i: number; r: IteratorResult<T, R> }>>();
  const pull = (i: number) => gens[i]!.next().then((r) => ({ i, r }));
  gens.forEach((_, i) => pending.set(i, pull(i)));
  try {
    while (pending.size) {
      const { i, r } = await Promise.race(pending.values());
      if (r.done) {
        results[i] = r.value;
        pending.delete(i);
      } else {
        pending.set(i, pull(i));
        yield r.value;
      }
    }
    return results;
  } finally {
    // Consumer stopped early: close the generators that are still running.
    if (pending.size) await Promise.allSettled([...pending.keys()].map((i) => gens[i]!.return(undefined as R)));
  }
}
