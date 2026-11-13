/** Internal grammar indexes are derived from bounded loops or validated spans.
 * Fail as an operational error if that invariant breaks; never invent evidence. */
export function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Internal matching index invariant failed.');
  return value;
}
