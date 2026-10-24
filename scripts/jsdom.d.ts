// Minimal types for the part of jsdom that check-mermaid.ts uses (avoids @types/jsdom).
declare module 'jsdom' {
  export class JSDOM {
    constructor(html: string);
    readonly window: Window & typeof globalThis;
  }
}
