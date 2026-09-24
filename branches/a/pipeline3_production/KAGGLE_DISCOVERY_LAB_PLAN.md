> **⚠️ SUPERSEDED / HISTORICAL DOCUMENT**
> This document is from the pre-canonical discovery/validation phase (2026-08-25).
> It is **NOT** authoritative for current status.
> **Current canonical status:** P3.08-DIST (Distributed Render) is EXPERIMENTAL.
> **P3.09:** Refers to Automated QA (qa.ts), not distributed rendering.
> See FULL_PIPELINE_CANONICAL_MANIFEST.md "Honest Status" section for current status.

# P3.09 Kaggle Discovery Lab Plan

**Date:** 2026-08-25  
**Status:** READY FOR EXECUTION  
**Objective:** Empirically validate what Kaggle infrastructure can actually do for P3.09 distributed rendering

---

## Executive Summary

The Kaggle Discovery Lab will execute 15 focused, <5-minute discovery notebooks against real Kaggle infrastructure to prove (not guess) what capabilities are available for P3.09 worker nodes.

This is NOT another planning document. This is the execution roadmap for running real experiments.

---

## Why Discovery Lab?

Previous work (audit + protocol) was solid theoretical groundwork. But theory differs from empirical reality. This lab answers the critical question:

**"What can Kaggle notebooks ACTUALLY do?"**

Not:
- "What does Kaggle docs say?"
- "What should theoretically work?"
- "What seems like it might work?"

But:
- "What tested, proven facts can we extract from real Kaggle execution?"

---

## The 15 Discovery Notebooks

Each notebook tests ONE capability in isolation, runs ≤5 minutes, and produces JSON evidence.

### TIER 1: Foundational Environment (Notebooks 00-03)

**00_discovery_framework.ipynb** ✅ CREATED
- Python version, OS, CPU, RAM, disk
- File I/O in /kaggle/working
- Basic subprocess execution
- **Evidence:** environment_probe.json

**01_gpu_capability_probe.ipynb** (TO CREATE)
- GPU detection (torch.cuda, nvidia-smi)
- GPU availability (NOT required, but nice-to-have)
- CPU fallback behavior
- **Evidence:** gpu_probe.json

**02_network_probe.ipynb** (TO CREATE)
- DNS resolution
- HTTPS outbound
- External API connectivity (GitHub, etc.)
- Rate limiting behavior
- **Evidence:** network_probe.json

**03_runtime_packages_probe.ipynb** (TO CREATE)
- FFmpeg / ffprobe
- Node.js / npm
- Python packages (Remotion deps if needed)
- Missing package fallback
- **Evidence:** runtime_probe.json

### TIER 2: Critical for P3.09 (Notebooks 05-08)

**05_parameter_passing_probe.ipynb** ✅ CREATED
- Environment variables (SHARD_ID, FRAME_START, FRAME_END)
- Kaggle notebook metadata API
- Config dataset reading
- CLI arguments
- **Evidence:** parameter_passing_results.json
- **CRITICAL:** Must find ≥1 working method

**06_secrets_credentials_probe.ipynb** (TO CREATE)
- Kaggle Secrets API
- Secret injection into environment
- Secret value access in notebook
- Secret leakage detection (logs/output)
- **Evidence:** secrets_probe.json

**07_dataset_readwrite_probe.ipynb** (TO CREATE)
- Reading from /kaggle/input/ datasets
- Writing to datasets
- Dataset versioning
- Output artifact creation
- **Evidence:** dataset_probe.json

**08_output_retrieval_probe.ipynb** (TO CREATE)
- Artifact storage in /kaggle/working/
- Output file metadata
- Retrievability after execution
- Size / checksum validation
- **Evidence:** output_probe.json

### TIER 3: Render Capabilities (Notebooks 09-10)

**09_micro_remotion_probe.ipynb** (TO CREATE)
- Real Remotion composition import
- Frame-range rendering (5-30 frames)
- H.264 output
- ffprobe validation
- Real artifact (not mock)
- **Evidence:** remotion_probe.json + shard.mp4

**10_ffmpeg_merge_probe.ipynb** (TO CREATE)
- FFmpeg concat on real videos
- Frame continuity validation
- Output integrity
- No re-encoding overhead
- **Evidence:** ffmpeg_probe.json + merged.mp4

### TIER 4: Orchestration (Notebooks 11-14)

**11_worker_shard_probe.ipynb** (TO CREATE)
- Two shards (0-9, 10-19 frames)
- Parameter passing per shard
- Independent execution
- Output retrieval per shard
- **Evidence:** worker_probe.json + shard_0.mp4 + shard_1.mp4

**12_concurrent_execution_probe.ipynb** (TO CREATE)
- Two notebooks submitted ~simultaneously
- Quota behavior
- Scheduling delays
- Max safe concurrency estimate
- **Evidence:** concurrency_probe.json

**13_failure_recovery_probe.ipynb** (TO CREATE)
- Controlled failure injection
- Failure detection via API
- Execution status polling
- Retry capability
- **Evidence:** failure_probe.json

**14_micro_e2e_probe.ipynb** (TO CREATE)
- Full orchestration mini-chain
- Parameters → render → merge → validate
- Single E2E proof
- **Evidence:** e2e_probe.json + final.mp4

### TIER 5: Authorization & API (Notebook 15)

**15_api_authorization_probe.ipynb** (TO CREATE)
- Kaggle API authentication
- Notebook push authorization
- Notebook execution authorization
- Dataset access permissions
- Secret access permissions
- Account tier limitations
- **Evidence:** api_auth_probe.json

---

## Discovery Notebook Structure (Template)

Every discovery notebook follows this pattern:

```
1. METADATA
   - Session ID
   - Timestamp
   - Test name
   - Timeout limits (≤5 min)

2. ENVIRONMENT
   - OS, Python version
   - Kaggle context

3. TEST EXECUTION
   - Actual capability test
   - Real operation (not mock)
   - Try/except with clear failure reasons

4. RESULT CLASSIFICATION
   - PASS: Capability confirmed working
   - FAIL: Capability broken/unavailable
   - UNKNOWN: Can't test due to constraint
   - BLOCKED: Architectural blocker

5. EVIDENCE ARTIFACT
   - JSON output with all details
   - Real file artifacts if applicable
   - Metadata for reproducibility

6. FINAL REPORT
   - Summary statistics
   - Clear verdict
   - Evidence save location
```

---

## Execution Plan

### PHASE 1: Create Remaining Discovery Notebooks (2-3 hours)

Notebooks 01-04, 06-15 need to be created following the template.

Each notebook should be:
- Self-contained (no dependencies between notebooks)
- Executable independently
- <5 minutes runtime target
- Produce parseable JSON evidence

### PHASE 2: Push Notebooks to Kaggle (30 minutes)

```bash
cd /home/user/youtube
for nb in pipeline3_production/notebooks/kaggle_discovery_*.ipynb; do
  kaggle notebooks push -s "mk350174-cmd/$(basename $nb .ipynb)" -p "$nb"
done
```

### PHASE 3: Execute Discovery Orchestrator (5-30 minutes)

```bash
python3 pipeline3_production/scripts/kaggle_discovery_orchestrator.py \
  --kaggle-username mk350174-cmd
```

The orchestrator will:
- Run each notebook sequentially
- Retrieve results after each execution
- Aggregate JSON findings
- Generate capability matrix

### PHASE 4: Generate Capability Matrix (30 minutes)

Creates: `KAGGLE_CAPABILITY_MATRIX.md`

Format:
```
| Capability | Documented | API Available | Empirical Result | Risk | Fallback |
|---|---|---|---|---|---|
| Parameter passing | YES | Method A/B/C | PASS: Method C works | LOW | env vars |
| Secrets access | YES | YES | FAIL | HIGH | alternate |
| ...
```

### PHASE 5: Generate Decision Document (30 minutes)

Creates: `KAGGLE_P3_09_PRODUCTION_DECISION.md`

Answers:
- Which capabilities are confirmed?
- Which are blocked?
- What are the risk vectors?
- Can P3.09 proceed with current design?
- What architectural adjustments (if any) are needed?

---

## Evidence Requirements

Every test MUST produce evidence. No guesses.

### For PASS results:
- Real file artifact (if applicable)
- Metadata (timestamps, versions, IDs)
- Reproducibility information
- Why it counts as PASS

### For FAIL results:
- Exact error message
- Failure scenario
- Environment state at failure
- Fallback status

### For UNKNOWN results:
- Why couldn't we test it?
- What constraint prevented testing?
- Can it be tested differently?
- Estimated risk if untested

### For BLOCKED results:
- What architectural blocker exists?
- Can it be worked around?
- Cost of workaround
- Recommendation

---

## Critical Success Metrics

Discovery lab is successful if we can answer YES to:

1. ✅ **Parameter passing:** Can we pass SHARD_ID, FRAME_START, FRAME_END to workers?
2. ✅ **Render capability:** Can Kaggle notebooks run real Remotion renders?
3. ✅ **FFmpeg:** Can we merge rendered shards?
4. ✅ **Output retrieval:** Can we get shard outputs after execution?
5. ✅ **E2E proof:** Can we prove full orchestration chain works with real execution?

If ANY of these is BLOCKED, we need architectural redesign before production.

---

## Discovery Output Files

After all 15 notebooks execute:

```
pipeline3_production/
├── KAGGLE_DISCOVERY_LAB_RESULTS.json     ← Master aggregate
├── KAGGLE_CAPABILITY_MATRIX.md            ← Formatted matrix
├── KAGGLE_AUTHORIZATION_AUDIT.md          ← Security findings
├── KAGGLE_P3_09_PRODUCTION_DECISION.md    ← Final verdict
└── discoveries/
    ├── 00_environment_results.json
    ├── 01_gpu_results.json
    ├── 05_parameter_passing_results.json
    ├── 09_remotion_results.json
    ├── 14_e2e_results.json
    └── [11 more]
```

---

## Timeline

**Total Effort:** 6-8 hours end-to-end

| Phase | Duration | Owner |
|---|---|---|
| Create notebooks 01-15 | 2-3h | Claude |
| Push to Kaggle | 30m | User (or CLI automated) |
| Execute orchestrator | 5-30m | Kaggle execution |
| Analyze results | 1-2h | Claude |
| Generate reports | 1h | Claude |
| **TOTAL** | **6-8h** | |

---

## Critical Rules for Discovery Lab

1. **NO GUESSES:** Only report tested facts
2. **NO MOCKS:** Use real Kaggle execution, not local simulation
3. **NO DOCUMENTATION EXTRAPOLATION:** Docs ≠ empirical reality
4. **CLEAR EVIDENCE:** Every result must have proof artifact
5. **FAILURE DOCUMENTATION:** FAIL and BLOCKED are as valuable as PASS
6. **REPRODUCIBILITY:** Every test must be re-runnable
7. **NO ARCHITECTURE CHANGES:** Discovery informs, doesn't rewrite P3.09
8. **5-MINUTE CONSTRAINT:** Discovery runs ≤5 min; production can be longer

---

## After Discovery Lab

### If all critical 5 items are PASS:
→ **P3.09 production implementation can proceed** with confidence

### If 1-2 items are BLOCKED:
→ Architectural adjustment needed (e.g., different parameter method, worker sizing)
→ Creates secondary blockers that must be resolved before production

### If 3+ items are BLOCKED:
→ P3.09 distributed render strategy may not be viable on Kaggle
→ Fallback to single-machine render or hybrid strategy required

---

## Next Steps

1. **Immediately:**
   - Create notebooks 01-04, 06-15
   - Review for correctness
   - Save to git

2. **After creation:**
   - Push to Kaggle
   - Run orchestrator
   - Collect results

3. **After collection:**
   - Analyze capability matrix
   - Generate decision document
   - Brief stakeholders

---

## Success Definition

Discovery lab is successful when:

✅ All 15 notebooks execute (or document why they couldn't)
✅ Capability matrix is complete and evidence-backed
✅ KAGGLE_P3_09_PRODUCTION_DECISION.md is issued with clear GO/NO-GO verdict
✅ P3.09 production implementation is either GREEN LIGHT or has documented architectural changes

---

**Status:** READY TO EXECUTE

**Next Action:** Create notebooks 01-04, 06-15 and push to Kaggle

**Expected Completion:** 1 day (discovery execution + analysis)

---

Generated: 2026-08-25  
Plan Version: 1.0  
Execution Framework: Real Kaggle notebooks only, no mocks
