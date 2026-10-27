# benchside

Browser-only tools for taking apart emails, ZIPs, PDFs and more. Everything runs locally — your files never leave your machine.

## Tools

| Tool | What it shows |
|---|---|
| [Mail analyzer](https://photom.github.io/benchside/mail/) | SPF, DKIM, DMARC, ARC, and the receiver's results for an `.eml` file |
| [ZIP analyzer](https://photom.github.io/benchside/zip/) | Every record of a ZIP file, ZIP64, local vs central headers, nested archives |
| [PDF analyzer](https://photom.github.io/benchside/pdf/) | Header, objects, cross-reference tables and streams, every revision of a PDF |

## How "nothing leaves your machine" is enforced

Every page carries a Content Security Policy that the browser enforces, including for background workers. Tools that need no network cannot connect anywhere. The mail analyzer can connect only to DNS-over-HTTPS resolvers, sending domain names only. Details: [privacy model](docs/explanation/privacy-model.md).

## Documentation

See [docs/](docs/README.md).

## Development

```sh
npm ci
npm run check
npm run build
```

Requires Node 24 or later.

## License

MIT. See [LICENSE](LICENSE).

The mail analyzer bundles a snapshot of the [Public Suffix List](https://publicsuffix.org/) (`packages/mail/data/public_suffix_list.dat`), maintained by its contributors and licensed under the [Mozilla Public License 2.0](https://mozilla.org/MPL/2.0/). The file keeps its license header.
