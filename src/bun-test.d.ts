// Minimal ambient declarations so `vue-tsc` accepts `bun:test` imports in
// test files without adding a dependency. The real runtime is provided by bun.
declare module "bun:test" {
  export function describe(name: string, fn: () => void | Promise<void>): void;
  export function test(
    name: string,
    fn: () => void | Promise<void>,
    timeout?: number,
  ): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function expect(actual: unknown): Matchers;
  export interface Matchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toContain(expected: unknown): void;
    toHaveLength(expected: number): void;
    toBeGreaterThan(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    toBeDefined(): void;
    toBeNull(): void;
    toThrow(...args: unknown[]): void;
    not: Matchers;
    rejects: { toThrow(...args: unknown[]): void };
  }
}

declare namespace Bun {
  function sleep(ms: number): Promise<void>;
}
