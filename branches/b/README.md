# B-Branch V5 — B08 Agent Reach technical foundation

Release: `B_BRANCH_V5_FINAL_WITH_AGENT_REACH_20260906`  
Package: `b-branch-strategic-control-plane@5.0.3-agent-reach.20260906`

B00→B12 architecture is preserved. SOP/M01–M10, Tekno Polimat identity and channel architecture are out of scope.

**No blanket production-ready claim.** Canonical installation, typecheck, build, repair tests and standalone guards pass. The unchanged legacy suite still has 10 failing expectations; full Vitest is therefore red. One real public web backend retrieval succeeded, while doctor, authenticated platforms and external compliance remain NOT VERIFIED.

## Start and verify

```bash
npm ci
npm run typecheck
npm run typecheck:repair
npm run build
npm run test:legacy
npm run test:repair
npm test
npm run verify:critical
npm run verify:integration
npm run verify:remaining
npm run lint:policy
npm run manifest
npm run verify:manifest
```

To run the canonical master-plan sequence and retain all failures in separate logs:

```bash
npm run verify:release -- /absolute/path/outside-release/verification
```

A failing gate remains a nonzero process exit; tests are not suppressed. `npm run typecheck` checks source. `npm run typecheck:repair` also checks all repair test files. The 15 original legacy test files retain pre-existing fixture/type debt and are executed by Vitest without pretending they pass strict test-source typechecking.

## Integration and reports

- `docs/AGENT_REACH_INTEGRATION.md`: concrete native capability, setup pin, request/result/review contracts and API usage.
- `FINAL_B_BRANCH_REPAIR_REPORT.md`: baseline comparison, controlled repairs and verification evidence.
- `FINAL_B_BRANCH_STATUS_AND_RISKS.md`: all open gates, deferred scope and required next actions.
- `verification/current/`: actual canonical run logs, clean npm-ci results and separate live provider status.
- `docs/INPUT_ARCHIVE_INVENTORY.json`: inventory of all 178 original files.
- `docs/CHANGESET.json` and `docs/CHANGES.patch`: exact source/test/tooling change inventory.
- `docs/history/`, `docs/REPAIR_REPORT.md`, `docs/REPAIR_LEDGER.json` and old `verification/results/`: historical evidence only; not current verification claims.

Only B08 invokes the external provider. External data never becomes VERIFIED merely because retrieval works. Confirmation and governance review are separate. There is no B13, vendored upstream provider or stored credential.

The ZIP is a source release: it intentionally excludes node_modules, generated dist, Python venvs and cache files. Its manifest covers all packaged files except the manifest itself; `npm ci && npm run build` recreates dist from the genuine lockfile.
