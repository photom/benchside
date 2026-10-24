# benchside

Browser-only tools for taking apart emails, ZIPs, PDFs and more. Everything runs locally — your files never leave your machine.

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
