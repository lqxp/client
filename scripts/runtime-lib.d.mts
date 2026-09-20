/**
 * Types for the runtime-config generator, which is plain ESM JavaScript shared
 * with the build scripts and has no types of its own.
 */
export interface RuntimeScriptOptions {
  [key: string]: unknown;
}

export function buildRuntimeScript(options?: RuntimeScriptOptions): string;
