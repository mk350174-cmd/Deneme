# P3.09 Empirical Validation Plan

**Purpose:** Define exact steps to unblock the 3 critical Kaggle capability gaps before declaring P3.09 production-ready.

**Timeline:** 1-2 days intensive testing  
**Effort:** 9-13 hours total  
**Prerequisites:** Kaggle CLI auth, ability to submit/monitor notebooks

---

## Critical Item #1: Notebook Parameter Passing

### Problem Statement
P3.09 orchestrator needs to pass `SHARD_ID`, `FRAME_START`, `FRAME_END` to submitted notebooks. No validated method exists.

### Test Matrix: 3 Methods to Try (in order)

#### Method A: CLI `--set-notebook-param` Flag

**Hypothesis:** Kaggle CLI supports parameter injection via `--set-notebook-param` flag.

**Test Steps:**

1. **Create test notebook** (`parameter_test_a.ipynb`)
   ```python
   # Cell 1: Read notebook parameters
   import os
   import json
   
   # Try to read parameters passed by orchestrator
   shard_id = os.environ.get('SHARD_ID', 'NOT_SET')
   frame_start = os.environ.get('FRAME_START', 'NOT_SET')
   frame_end = os.environ.get('FRAME_END', 'NOT_SET')
   
   results = {
       'shard_id': shard_id,
       'frame_start': frame_start,
       'frame_end': frame_end,
       'method': 'env_vars',
       'success': all(v != 'NOT_SET' for v in [shard_id, frame_start, frame_end])
   }
   
   with open('/kaggle/working/parameter_test_results.json', 'w') as f:
       json.dump(results, f)
   
   print(f"Parameter test results: {results}")
   ```

2. **Push notebook to Kaggle**
   ```bash
   cd notebooks
   kaggle notebooks push -s username/parameter-test-a
   ```

3. **Submit notebook with parameters**
   ```bash
   kaggle notebooks push -s username/parameter-test-a \
     --set-notebook-param SHARD_ID=test_shard_0 \
     --set-notebook-param FRAME_START=0 \
     --set-notebook-param FRAME_END=100
   ```
   (Note: `--set-notebook-param` may not exist; if command fails, note error)

4. **Check for errors**
   - **If flag not recognized:** Document error, proceed to Method B
   - **If flag accepted:** Continue to step 5

5. **Monitor execution** (wait for notebook to complete)
   ```bash
   # Monitor Kaggle UI or CLI
   kaggle kernels list -s username
   # Look for your-kernel status
   ```

6. **Download output and verify**
   ```bash
   # After notebook completes
   kaggle kernels output username/parameter-test-a -p ./output
   cat output/parameter_test_results.json
   ```

7. **Verify results**
   - **PASS:** If JSON shows `"success": true` and all values correctly passed
   - **FAIL:** If values are "NOT_SET" or JSON is missing

**Estimated Time:** 30-45 minutes  
**Risk:** Low (non-destructive test)  
**Dependency:** None

---

#### Method B: Environment Variables (Process-Level)

**Hypothesis:** Setting env vars before `kaggle notebooks push` propagates them to the notebook kernel.

**Test Steps:**

1. **Create test notebook** (`parameter_test_b.ipynb`)
   - Same code as Method A (reads env vars)

2. **Push notebook to Kaggle**
   ```bash
   kaggle notebooks push -s username/parameter-test-b
   ```

3. **Submit notebook with env vars set**
   ```bash
   export SHARD_ID=test_shard_0
   export FRAME_START=0
   export FRAME_END=100
   kaggle notebooks push -s username/parameter-test-b
   ```

4. **Monitor and download output**
   - Same as Method A steps 5-6

5. **Verify results**
   - **PASS:** If env vars correctly received
   - **FAIL:** If all vars are "NOT_SET"

**Estimated Time:** 20-30 minutes  
**Risk:** Low  
**Dependency:** Method A failed (or Method A passed and this is validation)

---

#### Method C: Configuration Dataset (Fallback)

**Hypothesis:** Pre-create a dataset with per-shard config JSON files; notebook reads from `/kaggle/input/`.

**Test Steps:**

1. **Create config JSON**
   ```bash
   mkdir -p /tmp/shard_configs
   cat > /tmp/shard_configs/test_shard_0_config.json << 'EOF'
   {
     "shard_id": "test_shard_0",
     "frame_start": 0,
     "frame_end": 100
   }
   EOF
   ```

2. **Create Kaggle dataset** (one-time, or inline via API)
   ```bash
   # Option A: Via kaggle CLI
   kaggle datasets create \
     -p /tmp/shard_configs \
     --dataset-license cc-by-4.0 \
     --dir-mode zip
   # (This will prompt for dataset info)

   # Option B: Via Web UI
   # - Go to kaggle.com/datasets/create
   # - Upload /tmp/shard_configs
   # - Create as "shard-configs-test"
   ```

3. **Create test notebook** (`parameter_test_c.ipynb`)
   ```python
   # Cell 1: Read from config dataset
   import os
   import json
   from pathlib import Path
   
   # Kaggle datasets are mounted in /kaggle/input/
   config_path = Path('/kaggle/input/shard-configs-test/test_shard_0_config.json')
   
   if config_path.exists():
       with open(config_path) as f:
           config = json.load(f)
       results = {
           'config': config,
           'method': 'config_dataset',
           'success': True
       }
   else:
       results = {
           'config': None,
           'method': 'config_dataset',
           'success': False,
           'error': f'Config not found at {config_path}'
       }
   
   with open('/kaggle/working/parameter_test_results.json', 'w') as f:
       json.dump(results, f)
   ```

4. **Push and run notebook**
   ```bash
   kaggle notebooks push -s username/parameter-test-c
   # Monitor execution
   kaggle kernels output username/parameter-test-c -p ./output
   ```

5. **Verify results**
   - **PASS:** If JSON shows `"success": true` and config correctly loaded
   - **FAIL:** If config not found or error in loading

**Estimated Time:** 45-60 minutes (mostly dataset creation overhead)  
**Risk:** Low  
**Dependency:** Methods A and B failed, or desired as baseline

---

### Expected Outcomes

| Outcome | Probability | Next Action |
|---|---|---|
| Method A succeeds | 20% | ✅ Use CLI parameter passing; no fallback needed |
| Method B succeeds | 30% | ✅ Use env var propagation; document in orchestrator |
| Method C succeeds | 95% | ✅ Use config dataset pattern (slower but reliable) |
| All fail | 5% | ❌ BLOCKER: Re-architect orchestrator (unlikely) |

### Contingency If All Fail
If no parameter passing method works, P3.09 would need to switch to a "push notebook + wait for result" model where config is hard-coded or sourced from the orchestrator's state (less elegant but viable).

---

## Critical Item #2: Session Timeout & Durability

### Problem Statement
Kaggle notebooks have a ~9 hour session limit. P3.09 may submit renders lasting 6-12 hours. Need to confirm if /kaggle/working output survives session termination.

### Test Plan

#### Phase 1: Quick Estimate (1-2 hours, optional)

**Goal:** Get rough estimate without waiting 9 hours.

1. **Create baseline notebook** (`session_test_quick.ipynb`)
   ```python
   import time
   import json
   from pathlib import Path
   
   # Simulate a short render
   print("Session test: Simulating 30-minute render...")
   time.sleep(30)  # In real test, this would be 1-2 hours
   
   # Write output
   output_file = Path('/kaggle/working/session_test_output.json')
   output_file.write_text(json.dumps({
       'test': 'session_durability',
       'duration_seconds': 30,
       'timestamp': str(time.time()),
       'output_persisted': True
   }))
   print(f"Output written to {output_file}")
   ```

2. **Run notebook** and monitor /kaggle/working
   ```bash
   kaggle notebooks push -s username/session-test-quick
   # Monitor with: watch 'kaggle kernels list -s username'
   ```

3. **Check for output file** (in Kaggle UI or via download)
   ```bash
   kaggle kernels output username/session-test-quick -p ./output
   ls -la output/session_test_output.json
   ```

4. **Verify file exists** → Extrapolate to longer durations
   - If quick test succeeds: confident that 3-4h duration is safe
   - If quick test fails: session timeout is a real problem at all durations

**Estimated Time:** 1-2 hours (including wait time)

#### Phase 2: Real Duration Test (3-6 hours, if needed)

**Goal:** Directly test a realistic shard duration (3-4 hours).

1. **Create realistic notebook** (`session_test_real.ipynb`)
   ```python
   import time
   import subprocess
   import json
   from pathlib import Path
   
   # Simulate a 3-hour Remotion render
   # (Use subprocess sleep or busy loop to consume CPU)
   print("Starting 3-hour session durability test...")
   start = time.time()
   
   # Simulate work (CPU-bound)
   while time.time() - start < 3 * 3600:  # 3 hours in seconds
       _ = sum(range(1000000))  # CPU work
   
   # Write marker at end
   output_file = Path('/kaggle/working/session_test_3h_complete.txt')
   output_file.write_text(f"Session survived 3-hour render. Timestamp: {time.time()}")
   print(f"Test complete. Output: {output_file}")
   ```

2. **Submit notebook and monitor**
   ```bash
   kaggle notebooks push -s username/session-test-3h
   # Monitor kernel status
   for i in {1..180}; do  # Check every 2 min for 6 hours
     kaggle kernels list -s username | grep session-test-3h
     sleep 120
   done
   ```

3. **Check if session dies before 3h mark**
   - **Survives:** Confident that 6h renders are safe, 9h is margin
   - **Dies at ~9h mark:** Confirms session timeout exists
   - **Dies earlier:** Note exact duration for sharding strategy

4. **Verify output file**
   ```bash
   kaggle kernels output username/session-test-3h -p ./output
   cat output/session_test_3h_complete.txt
   # Should show completion timestamp if render finished
   ```

**Estimated Time:** 3-6 hours (wall-clock), mostly waiting

### Expected Outcomes

| Outcome | Probability | Implication | Action |
|---|---|---|---|
| /kaggle/working persists, output found | 80% | ✅ Safe to render 6h shards | No change needed |
| Session dies but output persists | 15% | ✅ Safe if <9h shards | Adjust sharding to <8h max |
| Output lost on session termination | 5% | ❌ BLOCKER | Need alternative output strategy |

### Contingency: Output Persistence Alternatives
If /kaggle/working doesn't persist, fallback options:
1. **Immediate dataset upload** — Notebook uploads shard to dataset before session ends
2. **GCS/S3 staging** — Use Kaggle's built-in cloud connectivity to upload output
3. **Staged retrieval** — Orchestrator polls for output file; if missing, re-submits

---

## Critical Item #3: Concurrent Notebook Quota

### Problem Statement
P3.09 can't know max concurrent notebooks without testing. Affects parallelism strategy.

### Test Plan: Empirical Quota Discovery

#### Phase 1: Conservative Assumption (0 hours, baseline)

**Action:** Use 3 as max safe concurrent (pro tier standard).

```python
# In orchestration.ts::scheduling
MAX_SAFE_CONCURRENT_NOTEBOOKS = 3
# Rationale: Typical pro tier limit; proven conservative
# Can increase after empirical validation
```

**No testing required; conservative but safe.**

#### Phase 2: Empirical Validation (1-2 hours)

**Goal:** Discover actual concurrent limit for this account/tier.

1. **Create dummy notebook** (`quota_test_dummy.ipynb`)
   ```python
   import time
   # Placeholder notebook; just occupies a slot
   print("Quota test notebook running...")
   time.sleep(10)  # Quick notebook
   print("Done.")
   ```

2. **Submit 5 copies simultaneously**
   ```bash
   for i in {0..4}; do
     kaggle notebooks push -s username/quota-test-dummy-$i &
   done
   wait
   ```

3. **Monitor concurrent count**
   ```bash
   # Check Kaggle UI or poll
   for i in {1..30}; do
     echo "Check $i:"
     kaggle kernels list -s username --max-results 10 | grep 'quota-test'
     sleep 10
   done
   ```

4. **Record results**
   - Count how many actually run (not queued)
   - Note any throttling or queueing behavior
   - Check Kaggle account status page for limits

5. **Document findings**
   ```markdown
   # Concurrent Notebook Quota Test Results
   - Account Tier: [detected]
   - Submitted: 5 notebooks
   - Running Concurrently: [X]
   - Queued: [Y]
   - Max Safe Concurrent: [MIN(X) - 1]  # Conservative margin
   ```

**Estimated Time:** 30-45 minutes (plus wait for notebooks to run)

### Expected Outcomes

| Max Concurrent Found | Safety Factor | P3.09 Action |
|---|---|---|
| 1 | Use 1 | Sequential shards only (slowest) |
| 2 | Use 1 | Sequential or very limited parallelism |
| 3-5 | Use 3 | Use 3 safely, can scale to 5 with risk |
| >5 | Use 4-5 | High parallelism available |

### Contingency: If Quota Unexpectedly Low
- Adjust sharding to produce fewer, larger shards
- Accept longer total render time (sequential instead of parallel)
- Fallback to local-only render for non-critical renders

---

## Master Validation Timeline

### Recommended Execution Order

```
Day 1 (4-6 hours):
  ├─ 09:00-10:00   Item #1 Method A (CLI params)
  ├─ 10:00-10:30   Item #1 Method B (env vars)
  ├─ 10:30-11:30   Item #1 Method C (config dataset) [if A/B fail]
  ├─ 12:00-13:00   Item #3 Empirical Test (quota discovery)
  └─ 14:00-16:00   Item #2 Phase 1 (quick estimate, 30-min render)
                   [Or: start Item #2 Phase 2 if time permits]

Day 2 (optional, 3-6+ hours):
  ├─ Start of day   Item #2 Phase 2 (3-hour session test)
  ├─ Monitor        Let render run for 3-6 hours
  └─ End of day     Verify output persistence
```

### Parallel Work (While Waiting)

**While notebooks are running:**
- Update `scheduling.ts` with conservative quota (3)
- Document findings in audit report template
- Plan fallback strategies if any test fails
- Review P3.09 recovery logic

---

## Validation Success Criteria

### Must-Have Results

| Item | Must Succeed? | Consequence if Blocked |
|---|---|---|
| Parameter Passing | ✅ YES | Can't configure shard params (critical) |
| Session Timeout | ⚠️ OPTIONAL | Affects max shard duration (workaround: smaller shards) |
| Quota | ⚠️ OPTIONAL | Affects parallelism (fallback: sequential) |

### Minimum Viable Status for Production

```
✅ Parameter Passing: Method A, B, or C validated
⚠️ Session Timeout: Baseline duration confirmed safe (even if <9h)
⚠️ Quota: Conservative assumption (3) applied, actual tested in phase 2
```

**= RUNTIME-VALIDATED, suitable for production deployment**

---

## Documentation Deliverables

After validation completes, produce:

1. **`PARAMETER_PASSING_VALIDATION.md`**
   - Which method(s) work
   - Code example for orchestrator
   - Edge cases discovered

2. **`SESSION_DURABILITY_VALIDATION.md`**
   - Max safe render duration confirmed
   - Actual timeout behavior documented
   - Shard sizing recommendations

3. **`CONCURRENT_QUOTA_VALIDATION.md`**
   - Actual concurrent limit discovered
   - Scheduling adjustments needed
   - Performance implications

4. **Updated Audit Report**
   - Change status from REQUIRES_EMPIRICAL to RUNTIME-VALIDATED
   - Update capability matrix with real results
   - Final verdict: DISTRIBUTED-E2E-VALIDATED ✅

---

## Checklist for Executor

- [ ] Parameter Passing Method A tested (or skipped with note)
- [ ] Parameter Passing Method B tested (or skipped with note)
- [ ] Parameter Passing Method C tested (if A/B failed)
- [ ] Chosen method documented with code example
- [ ] Session timeout quick test completed (30-min render)
- [ ] Session timeout real test completed (3h render, if needed)
- [ ] Max safe duration documented
- [ ] Concurrent quota empirical test completed
- [ ] Actual max concurrent discovered
- [ ] Scheduling.ts updated with real limits
- [ ] All 3 validation reports generated
- [ ] Audit report updated: RUNTIME-VALIDATED ✅
- [ ] P3.09 code reviewed for any adjustments needed
- [ ] Ready for production deployment: YES/NO

---

**End of Empirical Validation Plan**
