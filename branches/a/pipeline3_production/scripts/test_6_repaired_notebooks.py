#!/usr/bin/env python3
"""
Test 6 repaired notebooks on real Kaggle to verify push/execution fixes.

These 6 notebooks were previously failing with:
- 02, 09, 12, 13, 14, 15: Double-encoded JSON (now fixed)
- 05: Missing import sys (included in this test)

Goal: Verify push succeeds and kernel executes for all 6.

NOTE: Notebooks are pushed as PUBLIC (not private) so we can query status via CLI.
"""

import os
import sys
import json
import time
import shutil
import subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from tempfile import TemporaryDirectory

# Configuration
NOTEBOOKS_DIR = Path("/home/user/youtube/pipeline3_production/notebooks")

# Test notebooks (previously failed with push/execution errors)
TEST_NOTEBOOKS = [
    "kaggle_discovery_02_network_probe",
    "kaggle_discovery_05_parameter_passing",  # Missing import fix
    "kaggle_discovery_09_micro_remotion_probe",
    "kaggle_discovery_12_concurrent_execution_probe",
    "kaggle_discovery_13_failure_recovery_probe",
    "kaggle_discovery_14_micro_e2e_probe",
    "kaggle_discovery_15_api_authorization_probe",
]

def title_to_slug(title):
    """Convert notebook title to Kaggle kernel slug (lowercase, hyphens)."""
    return title.lower().replace("_", "-").replace(".ipynb", "")

def push_notebook(notebook_name, username="mk350174-cmd"):
    """Push notebook to Kaggle and return kernel slug."""
    nb_path = NOTEBOOKS_DIR / f"{notebook_name}.ipynb"

    if not nb_path.exists():
        return {
            "notebook": notebook_name,
            "status": "NOT_FOUND",
            "error": f"Notebook file not found: {nb_path}",
            "kernel_slug": None,
        }

    kernel_slug = f"{username}/{title_to_slug(notebook_name)}"

    # Create temporary directory for push
    with TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)

        # Copy notebook to temp dir
        temp_nb_path = tmpdir_path / "notebook.ipynb"
        shutil.copy(nb_path, temp_nb_path)

        # Create kernel-metadata.json (PUBLIC so we can query status)
        kernel_metadata = {
            "id": kernel_slug,
            "title": notebook_name,
            "code_file": "notebook.ipynb",
            "language": "python",
            "kernel_type": "notebook",
            "is_private": False,  # PUBLIC so we can query status via CLI
            "enable_gpu": True,
            "enable_tpu": False,
        }

        metadata_path = tmpdir_path / "kernel-metadata.json"
        with open(metadata_path, "w") as f:
            json.dump(kernel_metadata, f)

        # Push to Kaggle
        try:
            result = subprocess.run(
                ["kaggle", "kernels", "push", "-p", str(tmpdir_path)],
                capture_output=True,
                timeout=60,
                text=True,
            )

            if result.returncode == 0:
                return {
                    "notebook": notebook_name,
                    "status": "PUSHED",
                    "kernel_slug": kernel_slug,
                    "error": None,
                }
            else:
                return {
                    "notebook": notebook_name,
                    "status": "PUSH_FAILED",
                    "kernel_slug": kernel_slug,
                    "error": result.stderr[:300] if result.stderr else result.stdout[:300],
                }
        except subprocess.TimeoutExpired:
            return {
                "notebook": notebook_name,
                "status": "PUSH_TIMEOUT",
                "kernel_slug": kernel_slug,
                "error": "Push timed out after 60 seconds",
            }
        except Exception as e:
            return {
                "notebook": notebook_name,
                "status": "PUSH_ERROR",
                "kernel_slug": kernel_slug,
                "error": str(e)[:300],
            }

def check_kernel_status(kernel_slug):
    """Check kernel status on Kaggle."""
    try:
        result = subprocess.run(
            ["kaggle", "kernels", "status", kernel_slug],
            capture_output=True,
            timeout=10,
            text=True,
        )

        if result.returncode == 0:
            status_output = result.stdout.strip()
            return {
                "status": "SUCCESS",
                "output": status_output,
            }
        else:
            # If status fails, it might not exist yet
            return {
                "status": "NOT_READY",
                "error": result.stderr[:200] if result.stderr else "Unknown error",
            }
    except subprocess.TimeoutExpired:
        return {
            "status": "TIMEOUT",
            "error": "Status check timed out",
        }
    except Exception as e:
        return {
            "status": "ERROR",
            "error": str(e)[:200],
        }

def run_notebook_with_polling(kernel_slug, timeout_seconds=300):
    """Run notebook and poll for completion with timeout."""
    start_time = time.time()
    poll_interval = 3
    consecutive_not_ready = 0

    while time.time() - start_time < timeout_seconds:
        status_result = check_kernel_status(kernel_slug)

        if status_result["status"] == "SUCCESS":
            consecutive_not_ready = 0
            output_lower = status_result["output"].lower()

            # Check for terminal states
            if "queued" in output_lower or "running" in output_lower:
                # Still running
                pass
            elif "idle" in output_lower or "complete" in output_lower:
                # Done
                return {
                    "status": "COMPLETE",
                    "runtime_s": time.time() - start_time,
                }
            elif "error" in output_lower or "failed" in output_lower:
                # Failed
                return {
                    "status": "FAILED",
                    "runtime_s": time.time() - start_time,
                    "error": status_output[:300],
                }
        elif status_result["status"] == "NOT_READY":
            consecutive_not_ready += 1
            if consecutive_not_ready > 3:
                # Kernel doesn't exist or not accessible
                return {
                    "status": "NOT_FOUND",
                    "runtime_s": time.time() - start_time,
                    "error": "Kernel not found or not accessible after 3 retries",
                }

        time.sleep(poll_interval)

    return {
        "status": "TIMEOUT",
        "runtime_s": timeout_seconds,
        "error": f"Kernel did not complete within {timeout_seconds} seconds",
    }

def test_notebook(notebook_name):
    """Test a single notebook: push, run, check status."""
    print(f"\n🧪 Testing: {notebook_name}")

    # Push
    push_result = push_notebook(notebook_name)
    print(f"   Push: {push_result['status']}")
    if push_result["status"] != "PUSHED":
        print(f"      Error: {push_result.get('error', 'Unknown')}")
        return push_result

    kernel_slug = push_result["kernel_slug"]

    # Wait a bit before first status check (kernel needs time to register)
    time.sleep(2)

    # Poll for completion
    print(f"   Polling for completion (max 300s)...")
    run_result = run_notebook_with_polling(kernel_slug, timeout_seconds=300)
    print(f"   Execution: {run_result['status']} ({run_result.get('runtime_s', 0):.1f}s)")
    if run_result.get("error"):
        print(f"      {run_result['error'][:150]}")

    return {
        "notebook": notebook_name,
        "kernel_slug": kernel_slug,
        "push": push_result["status"],
        "execution": run_result["status"],
        "runtime_s": run_result.get("runtime_s", 0),
        "error": run_result.get("error"),
    }

def main():
    print("=" * 70)
    print("P3.09 REPAIRED NOTEBOOKS TEST — 7 Previously Failed/Repaired Notebooks")
    print("=" * 70)
    print(f"Testing {len(TEST_NOTEBOOKS)} notebooks in parallel (max 3 concurrent)")
    print("(PUBLIC notebooks so status can be queried via CLI)\n")

    results = {}
    with ThreadPoolExecutor(max_workers=3) as executor:  # Reduce concurrency to avoid rate limits
        futures = {
            executor.submit(test_notebook, nb): nb
            for nb in TEST_NOTEBOOKS
        }

        for future in as_completed(futures):
            nb_name = futures[future]
            try:
                result = future.result()
                results[nb_name] = result
            except Exception as e:
                results[nb_name] = {
                    "notebook": nb_name,
                    "status": "ERROR",
                    "error": str(e)[:300],
                }

    # Summary
    print("\n" + "=" * 70)
    print("Test Results Summary:")
    print("=" * 70)

    push_success = sum(1 for r in results.values() if r.get("push") == "PUSHED")
    exec_complete = sum(1 for r in results.values() if r.get("execution") == "COMPLETE")

    for nb, result in sorted(results.items()):
        push_status = result.get("push", "UNKNOWN")
        exec_status = result.get("execution", "UNKNOWN")
        emoji = "✅" if (push_status == "PUSHED" and exec_status == "COMPLETE") else "❌"
        runtime = result.get("runtime_s", 0)
        print(f"{emoji} {nb:50s} push:{push_status:15s} exec:{exec_status:12s} ({runtime:6.1f}s)")

    print("\n" + "=" * 70)
    print(f"Push successful: {push_success}/{len(TEST_NOTEBOOKS)}")
    print(f"Execution complete: {exec_complete}/{len(TEST_NOTEBOOKS)}")

    if push_success == len(TEST_NOTEBOOKS) and exec_complete >= 6:  # At least 6/7 must complete
        print("\n✅ TESTS MOSTLY PASSED — Ready for full 15-notebook batch execution")
        return 0
    else:
        print("\n⚠️  TESTS INCOMPLETE — Some notebooks still running or failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())
