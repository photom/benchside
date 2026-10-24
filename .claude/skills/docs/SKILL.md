---
name: docs
description: How to write and update benchside documentation following Diátaxis (tutorials / how-to / reference / explanation). Use before implementing any new feature or behavior change (docs come first), when editing docs/ or the README, and when deciding where a piece of documentation belongs.
---

# Documentation (Diátaxis, written before implementation)

## Principles

- **Write the docs before the code.** For a new tool, a new check, or a change in behavior, first describe in docs/ what it does and how it behaves. That description is the source for the TDD scenarios (see the `tdd` skill).
- Each page belongs to exactly one of the four Diátaxis kinds. If a page mixes them, split it and link the parts.
- Everything in this repository is written in English.
- Docs that disagree with the code are a bug. If the spec changes during implementation, update the docs in the same change.

## Which kind of page

| Location | Purpose | Reader's situation | How to write |
|---|---|---|---|
| `docs/tutorials/` | Teach | First contact | One straight path. Use an example that always succeeds. No options, no background |
| `docs/how-to/` | Get a task done | Knows what they want | "How to …". Prerequisites, steps, result. Link to explanation for the why |
| `docs/reference/` | Look up facts | Searching | Complete, neutral, structured. Field tables, list of checks, conditions, output formats |
| `docs/explanation/` | Understand | Thinking | Background, design decisions, trade-offs, threat model. No step-by-step instructions |

Questions to ask when unsure:

- Is the reader doing something with their hands? Yes → tutorials / how-to. No → reference / explanation.
- Are they studying or working? Studying → tutorials / explanation. Working → how-to / reference.

## What to write before implementing a feature

1. **Reference**: the behavioral spec. For example, for each ZIP check: detection condition, severity, and reported message. This feeds the TDD scenarios directly.
2. **Explanation** (when a design decision is involved): why this approach, the alternatives, the trade-offs. Decision records go in `docs/explanation/decisions/NNNN-title.md` (sequential number; sections Context / Decision / Consequences).
3. **How-to** (when users gain a new action): how to use it.
4. Tutorials come once the feature is stable.

Add every new page to the index in `docs/README.md`.

## Style

- One topic per file. File names in kebab-case.
- Headings follow the reader's task or question ("How to …" for how-to, the subject's name for reference).
- When describing binary formats, give offset, size, and endianness in a table, and cite the source (APPNOTE.TXT section, ISO 32000 clause, RFC number).
- Never use real emails or personal data in examples. Build examples from synthetic data.
