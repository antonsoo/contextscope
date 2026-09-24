# Contributing

Issues and pull requests are welcome.

## Setup

```sh
npm install
npm test
npm run lint
npm run typecheck
```

## Before opening a PR

- Add tests for any change to `src/core` — this is the part everything else
  depends on, and it's designed to be pure and easy to test in isolation.
  Where correctness is checkable against an independent source (a second
  tokenizer implementation, a hand-computed cache scenario), prefer that over
  a bare assertion.
- `npm run lint && npm run typecheck && npm test` must pass.
- If you change the Anthropic or OpenAI caching rules in `src/core/pricing.ts`
  or `cache-*.ts`, cite the source (official docs URL + date, or the bundled
  reference you used) in a comment, the way the existing code does. Don't
  guess at pricing or thresholds.
- Keep new dependencies to a minimum, and justify them in the PR description.

## Reporting a bug in a finding or cache simulation

The most useful bug report is a minimal request JSON (or JSONL sequence) that
reproduces it, plus what you expected. If it's related to caching, note which
provider and model you were simulating for.
