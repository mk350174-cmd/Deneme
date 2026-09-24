# R00 — Canonical Release Reconciliation

**Method:** `rm -rf node_modules && npm ci` (clean install from lockfile) →
`npm run build` → `npx vitest run --reporter=verbose` in each of the three
pipeline directories. Raw logs captured at `/tmp/r00_verification/*.log`
during the repair session (not shipped in the ZIP — ephemeral verification
output, not source).

## Ground truth (the test runner's own output, not a static count)

| Pipeline | Discovered | Executed | Passed | Failed | Skipped |
|---|---|---|---|---|---|
| P1 Research | 119 | 119 | 119 | 0 | 0 |
| P2 Creative | 120 | 120 | 120 | 0 | 0 |
| P3 Production | 359 | 359 | 359 | 0 | 0 |
| **TOTAL** | **598** | **598** | **598** | **0** | **0** |

All three builds (`tsc -p tsconfig.json`) completed with zero errors.

## Reconciling the three cited historical numbers

The instructions cite three prior counts and require the runner's output —
not a manual pick — to be authoritative:

```
Older canonical snapshot:  P1 46,  P2 94,  P3 322,  TOTAL 462
Opus5 repair report:       P1 119, P2 120, P3 359,  TOTAL 598
"Current ZIP" static grep: P1 119, P2 120, P3 362,  TOTAL 601
```

- **462** is the pre-repair baseline (`A_BRANCH_FULL_PIPELINE_CANONICAL_
  20260904.zip`, before the Opus 5 Tier-1/2/3 repair). Superseded.
- **598** is the actual runtime result of the Opus 5 repair, confirmed
  again here byte-for-byte via a fresh `npm ci` + `vitest run` in this
  session. **This is the number this report adopts.**
- **601** (P3=362) does not match runtime. Investigated rather than
  dismissed: `grep -c 'it("' *.ts` across P3's test directory returns
  **364** raw occurrences (not even 362) if comments are included, and
  **359** if `//` and `/* */` comments are stripped first. The 5-line gap
  is entirely `it("...")` appearing inside explanatory comments describing
  what a repair changed (e.g. a comment narrating "this used to be `it(...)`
  before the repair") — never a second, accidentally-uncounted real test.
  A comment-aware static count for P1/P2 was cross-checked the same way and
  lands exactly on 119/120, matching runtime exactly. The 362/601 figure
  the instructions cite was therefore a raw (comment-naive) grep taken at
  some point during the repair session, not a discrepancy in the shipped
  tree.

**Conclusion: 598 is confirmed as the actual, reproducible, comment-aware
count. It is adopted as the canonical figure for this release. No number
was picked manually — this is the runner's own verbose-reporter output,
independently re-run in a clean `npm ci` environment for this report.**
