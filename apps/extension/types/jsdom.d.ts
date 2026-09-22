/**
 * The slice of jsdom these tests use.
 *
 * `jsdom` ships no types of its own and `@types/jsdom` is not in this
 * workspace's lock file. 00_AI_IMPLEMENTATION_INSTRUCTIONS.md pins the
 * dependency set, and a whole `@types` package would be a new dependency taken
 * on for four lines of surface — so the surface is declared here instead.
 * `@typescript-eslint/no-explicit-any` is set to `error` in this package, which
 * is the other reason this file exists rather than a cast at each call site.
 *
 * jsdom is a test dependency only. Nothing in `src/` imports it: the content
 * script runs against a real browser DOM, and this stands in for one.
 */
declare module 'jsdom' {
  export interface ConstructorOptions {
    /** The document's address, which `location.href` and origin checks read. */
    url?: string;
  }

  export class JSDOM {
    constructor(html: string, options?: ConstructorOptions);
    readonly window: Window & typeof globalThis;
  }
}
