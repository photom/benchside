# Privacy model

benchside exists so that people can inspect real, sensitive files — an email that may be phishing, a signed PDF, an archive from an unknown sender — without handing them to a third-party service.

## What stays local

Every file you open is read in your browser with the File API and parsed by JavaScript running on the page. File contents are never uploaded, logged, or stored. Decompression uses the browser's built-in `DecompressionStream`, and signature checks use Web Crypto.

## What leaves your machine

Email authentication (DKIM, SPF, DMARC, ARC) needs DNS records. benchside fetches them over DNS-over-HTTPS. By default these requests contain domain names only, never message contents. The DNS-over-HTTPS provider can still see which domains and DKIM selectors are looked up.

Some SPF records would need more: macros such as `%{l}` put the sender's local part into a query name, and `ptr` reveals the client IP address. benchside blocks such queries unless you allow them for one analysis ([REQ-MAIL-010](requirements/REQ-MAIL-010-dns-control.md)). You can turn DNS lookups off; the affected checks are then reported as not evaluated.

## How this is enforced

A promise in a README is easy to break by accident. Each tool therefore carries a Content Security Policy that limits where it can connect. Tools that need no network, such as the ZIP and PDF tools, cannot connect anywhere:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; connect-src 'none'; worker-src blob:; img-src 'self' blob: data:; object-src 'none'">
```

The mail tool can connect only to the DNS-over-HTTPS endpoints:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; connect-src https://cloudflare-dns.com https://dns.google; worker-src blob:; img-src 'self' blob: data:; object-src 'none'">
```

Even if benchside's code or a dependency tried to send data elsewhere, the browser would block it. This includes background workers, which start from `blob:` URLs so that they inherit the policy ([0004](decisions/0004-worker-from-blob-url.md)). You can verify this yourself in the browser's developer tools.

Runtime dependencies are kept to a minimum and all parsers are written in this repository, which keeps the amount of code you have to trust small and reviewable.
