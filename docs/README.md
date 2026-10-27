# benchside documentation

This documentation follows the [Diátaxis](https://diataxis.fr/) framework. Each page belongs to exactly one of four kinds:

| Section | Use it when you want to… |
|---|---|
| [Tutorials](tutorials/) | learn benchside by following a guided example |
| [How-to guides](how-to/) | get a specific task done |
| [Reference](reference/) | look up exact facts: formats, checks, outputs |
| [Explanation](explanation/) | understand the background and design decisions |

## How-to guides

- [Update the Public Suffix List snapshot](how-to/update-public-suffix-list.md) — run the update workflow and merge its pull request

## Reference

- [Mail analyzer specification](reference/mail/) — exact behavior, rules, findings, and data model
- [ZIP analyzer specification](reference/zip/) — structure, ZIP64, fields, nested archives, findings, hex view
- [PDF analyzer specification](reference/pdf/) — syntax, file structure, revisions, findings

## Explanation

- [Requirements](explanation/requirements/) — what users need and why

- [Privacy model](explanation/privacy-model.md) — what stays on your machine, and what does not
- [Architecture](explanation/architecture.md) — apps, packages, build, deploy, and tests
- [Mail analyzer architecture](explanation/mail-architecture.md) — modules, data flow, and key types
- [Mail analyzer detailed design](explanation/mail-detailed-design.md) — files, interfaces, worker protocol, DNS composition
- [Mail analyzer module design](explanation/mail-design/) — internals of each module
- [ZIP analyzer architecture](explanation/zip-architecture.md) — modules, worker protocol, UI
- [PDF analyzer architecture](explanation/pdf-architecture.md) — modules, worker protocol, UI
- [Decisions](explanation/decisions/) — records of design decisions and why they were made
