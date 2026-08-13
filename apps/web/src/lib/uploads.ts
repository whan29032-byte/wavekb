export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  let firstError: unknown;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      try { results[index] = await operation(values[index]!, index); }
      catch (error) { firstError ??= error; }
    }
  });
  await Promise.all(workers);
  if (firstError) throw firstError;
  return results;
}
