/** Tiny dependency-free assertion helper for the compiled logic suites. */
const assert = {
  equal(actual: unknown, expected: unknown, message?: string) {
    if (actual !== expected)
      throw new Error(message ?? `Expected ${String(expected)}, got ${String(actual)}`);
  },
  notEqual(actual: unknown, expected: unknown) {
    if (actual === expected) throw new Error('Expected different values');
  },
  ok(value: unknown) {
    if (!value) throw new Error('Assertion failed');
  },
  throws(fn: () => unknown) {
    let threw = false;
    try {
      fn();
    } catch {
      threw = true;
    }
    if (!threw) throw new Error('Expected rejection');
  },
};
export default assert;
