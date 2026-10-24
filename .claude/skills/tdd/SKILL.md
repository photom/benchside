---
name: tdd
description: Test-driven development for benchside. Write scenarios first, then go Red → Green → Refactor. Always use when writing or changing parser, check, or UI code, when fixing a bug, and when adding tests.
---

# TDD (scenarios first)

## Flow

1. **Check the docs**: find the spec rules in docs/reference and the acceptance criteria in the matching `REQ-*` record. If either is missing, write it first with the `docs` skill.
2. **Write the scenarios**: before touching production code, list the scenarios in the test file, in a state that can be committed.
3. **Red**: pick one scenario, write the test body, and **run it to see it fail**. Confirm it fails for the expected reason (not implemented, wrong value), not just a compile error.
4. **Green**: write the smallest implementation that passes.
5. **Refactor**: clean up while the tests stay green. Fix duplication and naming here.
6. Move to the next scenario. When all are done, run the whole suite.

Bug fixes follow the same flow: first write a scenario and test that reproduce the bug, see it fail, then fix.

## Writing scenarios

Use Given / When / Then, phrased in the language of the user or the spec. Do not describe implementation details (function internals, private state).

```ts
describe('ZIP: local header vs central directory mismatch', () => {
  it.todo('given an entry whose file name differs between the two, when parsed, then reports mismatch(name) as a warning');
  it.todo('given an entry where only the CRC differs, when parsed, then reports mismatch(crc)');
  it.todo('given an entry that uses a data descriptor, when parsed, then does not treat size 0 in the local header as a mismatch');
});
```

- List every scenario as `it.todo` first, then turn them into `it` one at a time.
- Always include **malformed input** scenarios, not just the happy path: truncated files, out-of-range offsets, negative or huge lengths, reference cycles (PDF `/Prev`), zero-byte input. The expected result is that the parser does not throw but reports a diagnostic.
- Start each scenario name with the spec rule ID it covers (for example `DKIM-6: given …`). Acceptance tests start with the requirement ID (`REQ-MAIL-010: …`).
- Use the same terms in scenario names as in the spec.

## Where tests live (vitest)

- Tests sit next to the code as `*.test.ts`. Parsers are DOM-independent, so they run in the Node environment. Only UI tests set an environment such as `happy-dom`.
- Build binary fixtures **in code** by default (small builder functions that produce ZIP or PDF bytes). That way the test shows what each byte is for.
- When a real file is needed, put it in `samples/` and record its origin and license in `samples/README.md`. Files that must not be published (real emails, etc.) go in `samples/private/` (ignored by git); tests depending on them skip when the file is absent.
- One behavior per test. Assert on the structure of the result (diagnostic kind, location, severity); exact message text is only checked in UI tests.
- Mock only at boundaries (DoH `fetch`, File API). Do not mock our own modules.
- Tests that feed large amounts of broken input (fuzz-style) verify that the parser does not crash, does not loop forever, and finishes in time.

## Don'ts

- Writing the implementation first and adding tests afterwards.
- Moving to Green without seeing Red.
- Weakening a test to make it pass (loosening expectations, skipping it). If the spec was wrong, fix the docs first.
