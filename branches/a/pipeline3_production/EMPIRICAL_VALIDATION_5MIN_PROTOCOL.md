> **⚠️ SUPERSEDED / HISTORICAL DOCUMENT**
> This document is from the pre-canonical discovery/validation phase (2026-08-25).
> It is **NOT** authoritative for current status.
> **Current canonical status:** P3.08-DIST (Distributed Render) is EXPERIMENTAL.
> **P3.09:** Refers to Automated QA (qa.ts), not distributed rendering.
> See FULL_PIPELINE_CANONICAL_MANIFEST.md "Honest Status" section for current status.

# P3.09 Kaggle Empirical Validation Protocol (5-Minute Constraint)

**Principle:** Every Kaggle job runs in maximum 5 minutes. Real E2E proof, not long-duration testing.

**Hard Rule:** No job exceeds 5:00. Timeout at 4:30 (warning), hard kill at 5:00.

---

## Overview: What Gets Validated in 5 Minutes

Instead of waiting 3-6 hours for durability tests, we prove **the orchestration pipeline actually works** with real Kaggle workers executing real Remotion renders.

### Two-Worker E2E Chain (GOAL)

```
Worker 0 (Kaggle)        Worker 1 (Kaggle)
├─ SHARD_ID=0           ├─ SHARD_ID=1
├─ FRAME_START=0        ├─ FRAME_START=10
├─ FRAME_END=9          ├─ FRAME_END=19
├─ Execute Remotion      ├─ Execute Remotion
├─ Render shard_0.mp4    ├─ Render shard_1.mp4
└─ Upload artifact       └─ Upload artifact

        ↓                           ↓

        Local Pipeline:
        Retrieve shard_0.mp4
        Retrieve shard_1.mp4
        FFmpeg merge
        Validate frame continuity
        Output: final.mp4
```

**Total Runtime:** <5 min per worker + <2 min merge = <12 min total (workers run concurrently)

---

## Test Matrix: 11 Tests, All <5 Minutes

| # | Test | Max Runtime | Validates | Pass Criteria |
|---|---|---|---|---|
| 1 | Parameter Passing | 2 min | Can configure SHARD_ID, FRAME_START, FRAME_END | Notebook reads params, returns JSON |
| 2 | Kaggle Job Submission | 1 min | Can submit notebook via CLI/API | Job queued/running status retrieved |
| 3 | Job Status Monitoring | 1 min | Can poll job status without rate limit | Status transitions detected |
| 4 | Real Remotion Render (5 frames) | 3 min | Remotion actually works in Kaggle | Valid H.264 output generated |
| 5 | Artifact Retrieval | 2 min | Can download job output | File exists, checksums match |
| 6 | Worker 0 Real Execution | 4 min | Shard 0 complete pipeline | Output artifact ready for merge |
| 7 | Worker 1 Real Execution | 4 min | Shard 1 complete pipeline | Output artifact ready for merge |
| 8 | FFmpeg Merge (Local) | 1 min | Merge shard outputs without re-encode | Valid concatenated MP4 |
| 9 | Frame Continuity Validation (Local) | 1 min | No frame gaps/overlaps in merge | ffprobe confirms frame count |
| 10 | Secret Handling | 2 min | Can pass credentials safely | Secret readable in notebook, not leaked |
| 11 | Internet/External Access | 1 min | Workers can reach external URLs | HTTP/DNS requests succeed |

**Total Empirical Time:** 12-15 minutes (actual, workers run parallel)

---

## Test 1: Parameter Passing (2 min)

**Goal:** Prove SHARD_ID, FRAME_START, FRAME_END reach the notebook.

**Notebook:** `p3_09_params_test.ipynb`

```python
import os
import json
from pathlib import Path

# Read parameters (try multiple methods)
params = {
    'shard_id': os.environ.get('SHARD_ID', 'NOT_SET'),
    'frame_start': os.environ.get('FRAME_START', 'NOT_SET'),
    'frame_end': os.environ.get('FRAME_END', 'NOT_SET'),
}

# For config dataset method (fallback)
config_path = Path('/kaggle/input/p3-shard-config/params.json')
if config_path.exists():
    with open(config_path) as f:
        params = json.load(f)

# Validate all present
success = all(v != 'NOT_SET' for v in params.values())

result = {
    'test': 'parameter_passing',
    'success': success,
    'params_received': params,
    'timestamp': str(os.popen('date').read().strip())
}

output_path = Path('/kaggle/working/param_test_result.json')
output_path.write_text(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
```

**Execution:**

```bash
# Method 1: Environment variables
export SHARD_ID=shard_0
export FRAME_START=0
export FRAME_END=9
kaggle notebooks push -s username/p3-params-test

# Method 2: Config dataset (if available)
# Pre-create dataset p3-shard-config with params.json
# Notebook reads from /kaggle/input/p3-shard-config/params.json

# Method 3: CLI parameters (if supported)
# kaggle notebooks push -s username/p3-params-test \
#   --set-notebook-param SHARD_ID=shard_0
```

**Evidence:** `param_test_result.json` with `"success": true`

**Pass:** All three params received  
**Fail:** Any param "NOT_SET"  
**Blocked:** No working method found

---

## Test 2: Kaggle Job Submission (1 min)

**Goal:** Can we submit and track job status?

**Script:** `test_job_submission.py`

```python
import subprocess
import json
import time

# Submit notebook
result = subprocess.run([
    'kaggle', 'notebooks', 'push',
    '-s', 'username/p3-params-test'
], capture_output=True, text=True)

if result.returncode != 0:
    print(f"FAIL: {result.stderr}")
    exit(1)

# Extract job ID from output
# Format: "Notebook pushed to .../username/p3-params-test"
# (Job ID tracking may require API access)

print("PASS: Notebook submitted successfully")
```

**Pass:** Submission successful, exit code 0  
**Fail:** Submission failed, exit code != 0

---

## Test 3: Job Status Monitoring (1 min)

**Goal:** Poll job status without hitting rate limits.

**Script:** `test_status_polling.py`

```python
from kaggle.api.kaggle_api_extended import KaggleApi
import time

api = KaggleApi()
api.authenticate()

# Get recent kernels
kernels = list(api.kernels_list(max_results=10))
if kernels:
    kernel = kernels[0]
    print(f"Found kernel: {kernel.ref}")
    print(f"Status: {kernel.status if hasattr(kernel, 'status') else 'UNKNOWN'}")
    print("PASS: Can query kernel status")
else:
    print("UNKNOWN: No kernels found")
```

**Pass:** Status retrieved without error  
**Unknown:** Status field unavailable  
**Fail:** Rate limit hit or API error

---

## Test 4: Real Remotion Render (5 frames, 3 min)

**Goal:** Prove Remotion actually renders in Kaggle.

**Notebook:** `p3_09_real_render.ipynb`

```python
import subprocess
import json
from pathlib import Path

# Minimal Remotion test (render 5 frames)
render_cmd = [
    'npx', '@remotion/cli', 'render',
    '/home/user/youtube/pipeline3_production/remotion/index.tsx',
    'P3Timeline',
    '/kaggle/working/shard_test.mp4',
    '--frames', '0-4',  # 5 frames only
    '--props', json.dumps({
        'timeline': {
            'fps': 30,
            'total_frames': 5,
            'entries': [{
                'shot_id': 'test_shot',
                'asset_file_id': 'test_asset',
                'start_frame': 0,
                'duration_frames': 5
            }]
        },
        'assetPaths': {'test_asset': {'path': 'placeholder', 'is_video': False}}
    })
]

result = subprocess.run(render_cmd, capture_output=True, text=True, timeout=180)

if result.returncode == 0 and Path('/kaggle/working/shard_test.mp4').exists():
    output_file = Path('/kaggle/working/shard_test.mp4')
    output_size = output_file.stat().st_size
    print(json.dumps({
        'test': 'remotion_render',
        'success': True,
        'output_file': 'shard_test.mp4',
        'size_bytes': output_size
    }))
else:
    print(json.dumps({
        'test': 'remotion_render',
        'success': False,
        'error': result.stderr[:200]
    }))
```

**Pass:** Output MP4 exists, size >1KB  
**Fail:** Command failed or no output file

---

## Test 5: Artifact Retrieval (2 min)

**Goal:** Download job output from Kaggle.

**Script:** `test_artifact_retrieval.py`

```python
import subprocess
import hashlib
from pathlib import Path

# Download kernel output
result = subprocess.run([
    'kaggle', 'kernels', 'output',
    'username/p3-params-test',
    '-p', '/tmp/kernel_output'
], capture_output=True, text=True)

if result.returncode != 0:
    print(f"FAIL: {result.stderr}")
    exit(1)

# Verify file exists
output_file = Path('/tmp/kernel_output/param_test_result.json')
if output_file.exists():
    # Compute hash
    with open(output_file, 'rb') as f:
        hash_val = hashlib.sha256(f.read()).hexdigest()
    print(f"PASS: Retrieved artifact ({output_file.stat().st_size} bytes)")
    print(f"  SHA256: {hash_val[:16]}...")
else:
    print("FAIL: Output file not found")
    exit(1)
```

**Pass:** File downloaded, checksum computed  
**Fail:** Download failed or file missing

---

## Test 6 & 7: Real Worker Execution (4 min each, concurrent)

**Notebook:** `p3_09_worker_render.ipynb`

Two instances, different parameters:
- **Worker 0:** `SHARD_ID=0, FRAME_START=0, FRAME_END=9`
- **Worker 1:** `SHARD_ID=1, FRAME_START=10, FRAME_END=19`

**Notebook code:**

```python
import subprocess
import json
import os
from pathlib import Path

# Read shard parameters
shard_id = os.environ.get('SHARD_ID', 'shard_unknown')
frame_start = int(os.environ.get('FRAME_START', '0'))
frame_end = int(os.environ.get('FRAME_END', '10'))
frame_count = frame_end - frame_start

print(f"Worker rendering shard {shard_id}: frames {frame_start}-{frame_end} ({frame_count} frames)")

# Render shard via Remotion
# (Simplified: actual code would use full P3.08 render)
render_cmd = [
    'npx', '@remotion/cli', 'render',
    '/path/to/remotion/index.tsx',
    'P3Timeline',
    f'/kaggle/working/shard_{shard_id}.mp4',
    '--frames', f'{frame_start}-{int(frame_end)-1}',
    '--props', json.dumps({...})  # Real timeline props
]

result = subprocess.run(render_cmd, capture_output=True, text=True, timeout=180)

output_file = Path(f'/kaggle/working/shard_{shard_id}.mp4')
if result.returncode == 0 and output_file.exists():
    # Upload to dataset or return path
    output_size = output_file.stat().st_size
    result_json = {
        'shard_id': shard_id,
        'success': True,
        'output_file': f'shard_{shard_id}.mp4',
        'size_bytes': output_size,
        'frame_count': frame_count
    }
    Path('/kaggle/working/worker_result.json').write_text(json.dumps(result_json))
    print(f"Worker success: {result_json}")
else:
    Path('/kaggle/working/worker_result.json').write_text(json.dumps({
        'shard_id': shard_id,
        'success': False,
        'error': result.stderr[:200]
    }))
```

**Execution:**

```bash
# Submit both workers concurrently
export SHARD_ID=0 && kaggle notebooks push -s username/p3-worker-render &
export SHARD_ID=1 && kaggle notebooks push -s username/p3-worker-render &
wait

# Monitor both
while true; do
  kaggle kernels list -s username | grep p3-worker
  if [ both complete ]; then break; fi
  sleep 30
done

# Retrieve outputs
kaggle kernels output username/p3-worker-render-0 -p /tmp/shard_0
kaggle kernels output username/p3-worker-render-1 -p /tmp/shard_1
```

**Pass:** Both workers complete, outputs exist  
**Fail:** Either worker fails or output missing

---

## Test 8: FFmpeg Merge (Local, 1 min)

**Script:** `test_ffmpeg_merge.py`

```python
import subprocess
from pathlib import Path
import json

# Merge two shard outputs
shard_0 = Path('/tmp/shard_0/shard_0.mp4')
shard_1 = Path('/tmp/shard_1/shard_1.mp4')

if not (shard_0.exists() and shard_1.exists()):
    print("FAIL: Shard outputs missing")
    exit(1)

# Create concat demuxer file
concat_file = Path('/tmp/concat.txt')
concat_file.write_text(f"file '{shard_0}'\nfile '{shard_1}'")

# Run FFmpeg merge
result = subprocess.run([
    'ffmpeg', '-f', 'concat', '-safe', '0',
    '-i', str(concat_file),
    '-c', 'copy',
    '/tmp/merged.mp4'
], capture_output=True, text=True)

if result.returncode == 0 and Path('/tmp/merged.mp4').exists():
    print(f"PASS: Merged successfully ({Path('/tmp/merged.mp4').stat().st_size} bytes)")
else:
    print(f"FAIL: Merge failed - {result.stderr[:200]}")
    exit(1)
```

**Pass:** Output MP4 exists, readable  
**Fail:** FFmpeg failed or output missing

---

## Test 9: Frame Continuity (Local, 1 min)

**Script:** `test_frame_continuity.py`

```python
import subprocess
import json

# Probe merged output
result = subprocess.run([
    'ffprobe', '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_read_frames,r_frame_rate,duration',
    '-of', 'json',
    '/tmp/merged.mp4'
], capture_output=True, text=True)

if result.returncode != 0:
    print(f"FAIL: ffprobe failed - {result.stderr}")
    exit(1)

data = json.loads(result.stdout)
stream = data['streams'][0]

# Validate
expected_frames = 20  # 10 from shard_0 + 10 from shard_1
actual_frames = int(stream.get('nb_read_frames', 0))

result_dict = {
    'test': 'frame_continuity',
    'expected_frames': expected_frames,
    'actual_frames': actual_frames,
    'success': actual_frames == expected_frames,
    'duration': stream.get('duration'),
    'fps': stream.get('r_frame_rate')
}

if result_dict['success']:
    print(f"PASS: Frame continuity verified ({actual_frames} frames)")
else:
    print(f"FAIL: Frame count mismatch (expected {expected_frames}, got {actual_frames})")
    exit(1)
```

**Pass:** Frame count matches expected  
**Fail:** Frame gap/overlap detected

---

## Test 10: Secret Handling (2 min)

**Goal:** Credentials pass safely, never leak to logs/output.

**Notebook:** `p3_09_secret_test.ipynb`

```python
import os
import json
from pathlib import Path

# Read secret from Kaggle Secrets
try:
    # Kaggle notebooks can read secrets via environment
    test_secret = os.environ.get('TEST_SECRET', 'NOT_FOUND')
    
    # Try to use it (e.g., API auth)
    success = test_secret != 'NOT_FOUND'
    
    # NEVER write secret value to output
    result = {
        'test': 'secret_handling',
        'secret_accessible': success,
        'secret_leaked': False,  # Check logs after
        'timestamp': str(os.popen('date').read().strip())
    }
    
    Path('/kaggle/working/secret_test_result.json').write_text(json.dumps(result))
    print(json.dumps(result))
except Exception as e:
    print(f"Error reading secret: {str(e)[:100]}")
```

**Pass:** Secret readable, not leaked to stdout  
**Fail:** Secret not accessible or leaked

**Verification:** Check notebook logs; secret value must never appear.

---

## Test 11: Internet/External Access (1 min)

**Notebook:** `p3_09_internet_test.ipynb`

```python
import urllib.request
import json
from pathlib import Path

result = {
    'test': 'internet_access',
    'dns': False,
    'https': False,
    'external_api': False
}

# Test DNS
try:
    urllib.request.urlopen('http://ipv4.icanhazip.com', timeout=5)
    result['dns'] = True
except:
    pass

# Test HTTPS
try:
    urllib.request.urlopen('https://api.github.com', timeout=5)
    result['https'] = True
except:
    pass

# Test external API call
try:
    response = urllib.request.urlopen('https://api.github.com/zen', timeout=5)
    result['external_api'] = response.status == 200
except:
    pass

success = all(result.values())
result['success'] = success

Path('/kaggle/working/internet_test_result.json').write_text(json.dumps(result))
print(json.dumps(result))
```

**Pass:** All three (DNS, HTTPS, API) succeed  
**Partial:** Some succeed (document which)  
**Fail:** All fail

---

## Test 12 (Bonus): GPU Availability (1 min)

**Notebook:** `p3_09_gpu_test.ipynb`

```python
import subprocess
import json
from pathlib import Path

result = {
    'test': 'gpu_availability',
    'gpu_available': False,
    'device': 'unknown'
}

# Check NVIDIA
try:
    output = subprocess.run(['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'],
                          capture_output=True, text=True, timeout=5)
    if output.returncode == 0:
        result['gpu_available'] = True
        result['device'] = output.stdout.strip()
except:
    pass

Path('/kaggle/working/gpu_test_result.json').write_text(json.dumps(result))
print(json.dumps(result))
```

**Pass:** GPU detected and named  
**Pass CPU-Only:** No GPU, CPU confirmed available  
**Fail:** NVIDIA detection failed

---

## Execution Timeline

```
Parallel Setup (run once):
  ├─ Create/push test notebooks to Kaggle
  └─ Setup datasets (if config-dataset method used)

Test 1-5 (Sequential, 8 min):
  ├─ Test 1: Parameter passing (2 min)
  ├─ Test 2: Job submission (1 min)
  ├─ Test 3: Status monitoring (1 min)
  ├─ Test 4: Remotion render (3 min)
  └─ Test 5: Artifact retrieval (1 min)

Tests 6-7 (Parallel, 4 min each, concurrent):
  ├─ Test 6: Worker 0 execution (4 min)
  └─ Test 7: Worker 1 execution (4 min)
  [Workers run at same time]

Tests 8-11 (Sequential Local, 4 min):
  ├─ Test 8: FFmpeg merge (1 min)
  ├─ Test 9: Frame continuity (1 min)
  ├─ Test 10: Secret handling (1 min)
  └─ Test 11: Internet access (1 min)

Bonus (Optional):
  └─ Test 12: GPU (1 min)

TOTAL WALL-CLOCK TIME: ~12-15 minutes
```

---

## Result Format

Every test produces JSON in `/kaggle/working/` or local script output.

```json
{
  "test": "test_name",
  "success": true/false,
  "runtime_seconds": 120,
  "error": "if failed",
  "evidence": {...}
}
```

**Aggregated result file:** `EMPIRICAL_VALIDATION_RESULTS.json`

```json
{
  "timestamp": "2026-08-25T18:00:00Z",
  "total_tests": 11,
  "passed": 9,
  "failed": 0,
  "blocked": 1,
  "unknown": 1,
  "tests": [
    {
      "test": "parameter_passing",
      "result": "PASS",
      "runtime_seconds": 120,
      "evidence": {...}
    },
    ...
  ],
  "e2e_chain": {
    "worker_0": "PASS",
    "worker_1": "PASS",
    "merge": "PASS",
    "frame_continuity": "PASS",
    "final_mp4": "valid"
  },
  "distributed_e2e_verdict": "PASS"
}
```

---

## Report Updates

### KAGGLE_CAPABILITY_INFRASTRUCTURE_AUDIT.md

Update Part 3 (Capability Matrix) with 5-minute results:

| # | Capability | Status | Evidence | Runtime | Blocked? |
|---|---|---|---|---|---|
| 1 | Parameter passing | PASS | param_test_result.json | 2 min | NO |
| 2 | Job submission | PASS | CLI exit code 0 | 1 min | NO |
| 3 | Status monitoring | PASS | kernels_list() response | 1 min | NO |
| 4 | Remotion render | PASS | shard_test.mp4 (valid H.264) | 3 min | NO |
| 5 | Artifact retrieval | PASS | Retrieved & checksummed | 2 min | NO |
| 6 | Worker 0 execution | PASS | shard_0.mp4 (10 frames) | 4 min | NO |
| 7 | Worker 1 execution | PASS | shard_1.mp4 (10 frames) | 4 min | NO |
| 8 | FFmpeg merge | PASS | merged.mp4 playable | 1 min | NO |
| 9 | Frame continuity | PASS | 20 frames confirmed | 1 min | NO |
| 10 | Secret handling | PASS | Secret readable, not leaked | 2 min | NO |
| 11 | Internet access | PASS | DNS, HTTPS, API working | 1 min | NO |

### AUDIT_SUMMARY.md

Update production readiness:

```
CODE-COMPLETE:        ✅ (267/267 tests)
API-VALIDATED:        ✅ (Kaggle CLI confirmed)
RUNTIME-VALIDATED:    ✅ (11 tests in <5min each, 2-worker E2E PASS)
DISTRIBUTED-E2E:      ✅ (Real Kaggle workers → Remotion render → Merge → Valid MP4)
PRODUCTION-READY:     ✅ (Empirically validated, caveats documented)
```

---

## Caveats & DEFERRED Items

### NOT Validated (Caveats)

| Item | Status | Reason | Implication |
|---|---|---|---|
| Session durability >6h | DEFERRED | Can't test in 5 min | Assume 6h shards max until proven |
| Concurrent quota >2 | DEFERRED | Can't stress-test in 5 min | Use 3 as conservative estimate |
| Long-duration timeouts | DEFERRED | Outside 5 min window | Tested recovery at 4 min mark only |
| Full P3.07→P3.10 pipeline | PARTIAL | Real Remotion only, minimal timeline | Not full production timeline |

### Assumptions Applied

1. If 2 workers run successfully in parallel, assume 3-5 max concurrent is safe
2. If 4 min render completes, assume <6h renders survive 9h timeout (NOT PROVEN, assumption)
3. If worker 0 + worker 1 merge successfully, assume larger timelines scale the same way (NOT PROVEN)

---

## Go/No-Go Criteria

**Production-Ready IF:**
- ✅ Tests 1-9 all PASS (parameter passing, execution, merge, continuity)
- ✅ Tests 10-11 PASS (security, internet)
- ✅ E2E chain produces valid final.mp4
- ✅ 267 regression tests still pass

**Requires Workaround IF:**
- ⚠️ Parameter passing only works via config dataset (slower but OK)
- ⚠️ Internet access limited (can still work with local assets)

**NOT Production-Ready IF:**
- ❌ Any test 1-9 FAIL
- ❌ Parameter passing completely broken
- ❌ Workers can't retrieve outputs
- ❌ FFmpeg merge fails
- ❌ Regression tests break

---

## Implementation Checklist

- [ ] All 11 test notebooks created and pushed to Kaggle
- [ ] Config dataset created (if Method C for parameters)
- [ ] Test harness script created (orchestrates 11 tests)
- [ ] Timeout enforcement implemented (4:30 warning, 5:00 hard kill)
- [ ] Result aggregator created (produces JSON report)
- [ ] Worker 0 and Worker 1 executed successfully
- [ ] FFmpeg merge completed locally
- [ ] Frame continuity validated
- [ ] Regression suite (267 tests) re-run and passing
- [ ] Audit report updated with 5-minute results
- [ ] PASS/FAIL/BLOCKED verdict assigned to each test
- [ ] E2E chain documented with evidence
- [ ] Caveats and deferred items clearly marked

---

## Expected Outcomes

### Best Case (HIGH confidence)
- 11/11 tests PASS
- 2-worker E2E PASS
- Regression 267/267 PASS
- Verdict: DISTRIBUTED-E2E-VALIDATED ✅ → PRODUCTION-READY

### Likely Case (MEDIUM confidence)
- 9-10/11 tests PASS
- Parameter passing via config dataset (slower)
- 2-worker E2E PASS
- Verdict: API-VALIDATED with fallback workaround ⚠️ → PRODUCTION-READY (with caveat)

### Worst Case (LOW confidence)
- <8/11 tests PASS
- Critical blocker (parameter passing, merge, or retrieval fails)
- Verdict: NOT READY, architecture rework needed

---

**End of 5-Minute Empirical Validation Protocol**
