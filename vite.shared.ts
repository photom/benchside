import type { Plugin, UserConfig } from 'vite';

/** DNS-over-HTTPS endpoints allowed for the mail app (DNS-5, DNS-9). */
export const DOH_ORIGINS = ['https://cloudflare-dns.com', 'https://dns.google'];

/** Builds the CSP for one app. `connect` lists the only origins it may contact. */
export function cspPolicy(connect: readonly string[]): string {
  return [
    "default-src 'self'",
    `connect-src ${connect.length > 0 ? connect.join(' ') : "'none'"}`,
    'worker-src blob:',
    "img-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** Injects the CSP meta tag first in <head>. Build only: dev mode uses inline styles (0002). */
function cspMeta(connect: readonly string[]): Plugin {
  return {
    name: 'benchside-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: cspPolicy(connect) },
        injectTo: 'head-prepend',
      },
    ],
  };
}

/** Shared Vite config for every app (0005). */
export function defineApp(name: string, options: { connect: readonly string[] }): UserConfig {
  return {
    base: name === 'home' ? '/benchside/' : `/benchside/${name}/`,
    plugins: [cspMeta(options.connect)],
    worker: { format: 'es' },
    build: { sourcemap: true },
  };
}
