# R06 — Distributed Verification

Required chain, before live Kaggle:

```
approved package -> render bundle -> bundle hash -> code SHA -> asset mapping -> worker
```

plus: shard failure -> recovery path -> retry/reassignment, for the
implemented recovery cases.

Every link below is proven by an executable test, run in this repair pass,
not asserted from reading the code. File and test names are given so the
claim is checkable.

## approved package -> render bundle

`renderBundle.ts::buildRenderBundle()` takes the production package
manifest, resolved assets, render config, and pinned code version and
produces one immutable `RenderBundle`.

- **Test:** `tests/tier1.semantics.test.ts` — "T1.8 immutable render
  bundle" (7 tests): bundle_hash changes with timeline/asset/code-version
  changes; a timeline entry outside the asset manifest is refused at build
  time.

## render bundle -> bundle hash

`bundle.bundle_hash` is a `contentHash()` over the bundle's own content
(never self-referential). `verifyRenderBundle()` recomputes and compares.

- **Test:** same suite — "verifyRenderBundle detects post-seal mutation".

## bundle hash -> code SHA

`assertPinnedCodeVersion()` requires a full 40-hex git commit SHA (or a
sufficiently long release digest) — rejects branch names, tags, and `HEAD`.
The generated Kaggle kernel script checks out the pinned SHA with
`git fetch --depth 1 origin <sha>` + `git checkout --detach <sha>`, never
`git pull`.

- **Test:** "R02.4/T1.9 production code pinning" (5 tests: full SHA
  accepted, branch/HEAD/short-SHA rejected, release digest accepted).
- **Test:** `tests/orchestration_p309.integration.test.ts` —
  "T1.8/T1.9: the render bundle's real timeline and pinned code version
  reach the worker payload" — proves the pinned SHA literally appears in
  the generated kernel's embedded Python source, and the old
  `git ... pull` invocation does not.

## bundle hash -> asset mapping -> worker

`buildWorkerPayload()` re-verifies `bundle_hash` immediately before
serializing the timeline/asset-manifest/render-config/code-version into the
payload actually sent to the Kaggle kernel parameter bundle. The generated
Python script writes this into Remotion's `--props` file — never an empty
`{}`.

- **Test:** "buildWorkerPayload carries the REAL timeline, never an empty
  placeholder" / "refuses a bundle that was mutated after sealing".
- **Test (R02.5 — the additional byte-level proof this repair pass added):**
  "R02.5 worker asset binding" (5 tests) — proves
  `asset_file_id -> exact staged file -> SHA-256 match` end-to-end,
  including one integration test that shows `renderTimeline()` itself
  refuses to render when a staged file's real bytes don't match the
  bundle's declared hash (a swapped/corrupted-file scenario), never
  rendering a single frame in that case.

## shard failure -> recovery -> retry/reassignment -> success or final failure

- **Test:** `tests/orchestration_p309.integration.test.ts` —
  "R02.4: a transient (timeout) shard failure is retried by
  FailureRecoveryOrchestrator on the primary path, and succeeds" — proves
  the recovery orchestrator (previously constructed but never invoked, per
  R02.4's finding) genuinely intercepts a real failure on the primary
  `phase3Execution` path and recovers it.
- **Test:** "T1.10: a single failed shard produces result: 'partial'" —
  proves that when recovery is genuinely exhausted (a permanently-broken
  shard, identified by shard_id across every retry), the workflow reports
  `partial`, never a merged `success` with missing shards.

## Documented limitation carried into this report (not silently omitted)

`reassign_worker`'s "alternate worker" does not currently change which
Kaggle kernel/accelerator a resubmission targets — the Kaggle submission
path in this codebase does not vary by `WorkerType`. A reassignment retry
on this path is therefore functionally an additional retry on the same
infrastructure, not a genuine move to different hardware. This does not
weaken the tested behavior for the failure classes recovery.ts actually
targets (timeout, transient network, OOM) — those benefit from a retry
regardless of whether the "worker" nominally changed — but it means
`reassign_worker`'s distinct value proposition over plain `retry` is not
yet realized end-to-end. Recorded as `REMAINS` in the final acceptance
report.

## Scope note

None of the above touches a real Kaggle account, a real network call, or a
real GPU. Every test uses an injected `ExecKaggleCli` fixture. This is
exactly what R06 asks for — verification "before live Kaggle" — and R07 is
where (and only where) a real Kaggle E2E is attempted.
