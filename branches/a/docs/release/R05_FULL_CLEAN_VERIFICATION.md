# R05 — Full Clean Verification

**Method:** for each of the three pipelines, `rm -rf node_modules dist` →
`npm ci` (lockfile-exact, not `npm install`) → `npm run build` (which is
`tsc -p tsconfig.json` — the repo defines no separate `typecheck` script,
so build IS the typecheck) → `npm test` (`vitest run`). No repository
defines any other verification script beyond build/test;
`scripts/build_canonical_snapshot.sh` exists but is a packaging script
(used for R08), not a test/verification script.

## Result

| Pipeline | `npm ci` | `npm run build` | `npm test` |
|---|---|---|---|
| P1 Research | clean (48 packages) | 0 errors | 124/124 passed |
| P2 Creative | clean (48 packages) | 0 errors | 133/133 passed |
| P3 Production | clean (206 packages) | 0 errors | 425/425 passed |
| **TOTAL** | | **0 errors** | **682/682 passed, 0 failed, 0 skipped** |

This is the exact runner output, not a static count (see R00's
reconciliation for the methodology and its 598-test baseline before the
R01–R04 additions in this repair pass; the +84 tests since R00 are every
proof test added across R01.1–R01.6, R02.1–R02.6, R03, R03.1, and R04).

No test was weakened or deleted to reach this state. Every test added in
this repair pass targets a specific, named repair item and is documented
in that item's own section of the completion report.
