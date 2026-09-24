# R07 — Kaggle: Exact Verification (code-level) + Real E2E (environment check)

## Part A — post-upload exact verification: FIXED, VERIFIED

- **Problem:** `createKaggleDatasetForVideo`'s post-upload check
  (`pipeline3_production/src/kaggle.ts`) compared only the COUNT of remote
  files against the count staged locally
  (`verifiedFileCount < stagedFiles.length`). Two files with the wrong
  names, or the wrong file entirely, would pass as long as the number of
  remote entries matched.
- **Root cause:** the check never inspected the CSV's actual `(name, size)`
  rows — it only counted lines.
- **Files:** `pipeline3_production/src/kaggle.ts`,
  `pipeline3_production/tests/kaggle.test.ts`,
  `pipeline3_production/tests/golden.integration.test.ts`.
- **Solution:** the real CSV rows are now parsed and compared against the
  locally-staged file set for exact equality: every expected filename must
  appear remotely (missing -> fail), no unexpected filename may appear
  remotely (extra -> fail), and when a local file's real on-disk size is
  available, it must match the reported remote size (mismatch -> fail).
  The invariant implemented is literally `LOCAL EXPECTED SET == REMOTE
  ACTUAL SET`, per the repair instructions' own phrasing.
- **Honest limitation documented in the code itself:** the real
  `kaggle datasets files <id> --csv` command reports name and size, not a
  content hash. "hash when retrievable" is therefore not retrievable
  through this specific command — comparing declared vs. actual BYTES at
  the hash level would require downloading the dataset back down, which is
  a separate, heavier verification this repair does not add. This is
  stated in the code's own comment, not silently treated as "hash
  verified."
- **Tests:** `pipeline3_production/tests/kaggle.test.ts` — new "R07: catches
  a wrong-filename remote upload even when the COUNT matches (the old
  check's exact blind spot)" (proves the specific defect is closed) and
  "R07: an exact filename AND size match succeeds" (proves the happy path
  still works). Two pre-existing fixtures
  (`kaggle.test.ts`'s `fixtureExec`, `golden.integration.test.ts`'s
  `fixtureExecKaggleCli`) turned out to report a hardcoded, unrelated
  filename that only "worked" under the old count-only check — both were
  fixed to genuinely track and report the real staged filename, which is
  itself evidence the old check's blind spot was real and previously
  unexercised even by the existing test suite.
- **Verification: FIXED, VERIFIED.** Full P3 suite: 427/427 passing after
  this change (see R05's clean-verification numbers plus this repair's own
  additions).

## Part B — real Kaggle E2E: UNAVAILABLE, NOT VERIFIED

This repair session's execution environment was checked directly for the
prerequisites a real Kaggle E2E requires:

```
$ which kaggle        -> not found
$ ls ~/.kaggle/        -> No such file or directory
$ env | grep -i kaggle -> (empty)
$ python3 -c "import kaggle" -> ModuleNotFoundError: No module named 'kaggle'
```

No Kaggle CLI, no credentials file, no Kaggle Python package, and no
`KAGGLE_USERNAME`/`KAGGLE_KEY` environment variables are present. A real
`kaggle kernels push` / `kaggle datasets create` / `kaggle kernels status`
call cannot be made from here.

**This is reported honestly as `UNAVAILABLE` / `NOT VERIFIED` for the live
E2E target described in R07:**

```
approved render bundle -> Kaggle submission -> real execution ->
real shard output -> download -> hash verification -> merge -> QA ->
final delivery
```

Per the repair instructions' own reporting rule ("Do not claim a test
count from static grep... Never inflate readiness because a fixture
passed"), this report does not claim the live E2E ran, and does not
substitute the fixture-based distributed tests (R06) as if they proved the
live path — R06's tests prove the code's LOGIC is correct against a
scripted CLI; they cannot and do not prove that a REAL Kaggle kernel
actually executes, produces real GPU/CPU render output, and that output
downloads and hashes correctly over a real network. That gap is real and
is recorded, not minimized.

**What IS true, and is not being overclaimed away:** every step of the
pipeline up to the network boundary (bundle construction, code pinning,
worker payload construction, kernel script generation, exact-set
post-upload verification, recovery wiring) is exercised by executable
tests against realistic fixture CLI responses (R02.4, R02.5, R06). The gap
this report is honest about is specifically: no test in this repair
session has ever invoked the real `kaggle` binary against the real Kaggle
API.

## Recommendation for whoever runs the real E2E

1. Install the `kaggle` CLI and provide real `KAGGLE_USERNAME`/`KAGGLE_KEY`
   credentials (or `~/.kaggle/kaggle.json`).
2. Set `P309_CODE_VERSION_SHA` to a real, pushed commit SHA of this repo (a
   requirement `p309_live_execution.ts` already enforces — see T1.9).
3. Run the existing manual verification entry point
   (`pipeline3_production/src/p309_live_execution.ts`) or a small
   dedicated script calling `P309Orchestrator.orchestrateFullWorkflow`
   with `execKaggle` left at its real default (`defaultExecKaggleCli`,
   which shells out to the actual `kaggle` CLI) instead of a fixture.
4. Confirm the final artifact's hash chain end-to-end exactly as the
   fixture tests already prove the logic should behave.

This is not deferred as an oversight — it is deferred because the
prerequisite infrastructure genuinely does not exist in this session, and
fabricating a "PASSED" result for a live network call that never happened
would be a direct violation of this repair's own reporting rule.
