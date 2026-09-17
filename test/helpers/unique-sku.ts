/** Unique product SKUs for integration tests that share one DB. */
export function createUniqueSkuFactory(prefix = 'SKU') {
  let seq = 0;
  return (label = prefix) => `${label}-${Date.now()}-${++seq}`;
}
