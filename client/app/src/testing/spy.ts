/**
 * Vitest helpers that mirror the Jasmine spy helpers used in Angular specs.
 */

import { vi, type Mock } from 'vitest';

/** Object whose listed methods are Vitest mocks. */
export type SpyObj<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown ? Mock : T[K];
};

/**
 * Builds a partial stub with `vi.fn()` for each method name.
 *
 * @param _name - Unused label kept for call-site parity with Jasmine.
 * @param methods - Method names to mock.
 * @param props - Extra properties (signals, fields) to attach.
 */
export const createSpyObj = <T extends object>(
  _name: string,
  methods: readonly (keyof T & string)[],
  props?: Partial<T>,
): SpyObj<T> => {
  const obj = { ...(props ?? {}) } as SpyObj<T>;
  for (const method of methods) {
    (obj as Record<string, Mock>)[method] = vi.fn();
  }
  return obj;
};
