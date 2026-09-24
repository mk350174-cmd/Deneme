#!/usr/bin/env python3
"""
Test 6 repaired notebooks on real Kaggle with unique kernel IDs (v2).

Uses unique kernel IDs (with timestamp suffix) to avoid 409 Conflict errors
from duplicate kernel IDs.
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

# Test notebooks
TEST_NOTEBOOKS = [
    "kaggle_discovery_02_network_probe",
    "kaggle_discovery_05_parameter_passing",
    "kaggle_discovery_09_micro_remotion_probe",
    "kaggle_discovery_12_concurrent_execution_probe",
    "kaggle_discovery_13_failure_recovery_probe",
    "kaggle_discovery_14_micro_e2e_probe",
    "kaggle_discovery_15_api_authorization_probe",
]

def title_to_slug(title):
    """Convert notebook title to Kaggle kernel slug."""
    return title.lower().replace("_", "-").replace(".ipynb", "")

def push_notebook(notebook_name, username="mk350174-cmd", version_suffix="v2"):
    """Push notebook with unique kernel ID (using timestamp suffix)."""
    nb_path = NOTEBOOKS_DIR / f"{notebook_name}.ipynb"

    if not nb_path.exists():
        return {
            "notebook": notebook_name,
            "status": "NOT_FOUND",
            "error": f"File not found: {nb_path}",
            "kernel_slug": None,
        }

    # Use versioned slug to avoid 409 Conflict
    base_slug = title_to_slug(notebook_name)
    kernel_slug = f"{username}/{base_slug}-{version_suffix}"

    with TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        temp_nb_path = tmpdir_path / "notebook.ipynb"
        shutil.copy(nb_path, temp_nb_path)

        kernel_metadata = {
            "id": kernel_slug,
            "title": f"{notebook_name} ({version_suffix})",
            "code_file": "notebook.ipynb",
            "language": "python",
            "kernel_type": "notebook",
            "is_private": False,
            "enable_gpu": True,
            "enable_tpu": False,
        }

        metadata_path = tmpdir_path / "kernel-metadata.json"
        with open(metadata_path, "w") as f:
            json.dump(kernel_metadata, f)

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
                    "error": result.stderr[:300],
                }
        except subprocess.TimeoutExpired:
            return {
                "notebook": notebook_name,
                "status": "PUSH_TIMEOUT",
                "kernel_slug": kernel_slug,
                "error": "Push timeout",
            }
        except Exception as e:
            return {
                "notebook": notebook_name,
                "status": "PUSH_ERROR",
                "kernel_slug": kernel_slug,
                "error": str(e)[:300],
            }

def check_kernel_status(kernel_slug):
    """Check kernel status via kaggle CLI."""
    try:
        result = subprocess.run(
            ["kaggle", "kernels", "status", kernel_slug],
            capture_output=True,
            timeout=10,
            text=True,
        )

        if result.returncode == 0:
            return {
                "status": "SUCCESS",
                "output": result.stdout.strip(),
            }
        else:
            return {
                "status": "NOT_READY",
                "error": result.stderr[:200],
            }
    except Exception as e:
        return {
            "status": "ERROR",
            "error": str(e)[:200],
        }

def run_notebook_with_polling(kernel_slug, timeout_seconds=300):
    """Poll kernel for completion."""
    start_time = time.time()
    poll_interval = 3
    consecutive_errors = 0

    while time.time() - start_time < timeout_seconds:
        status_result = check_kernel_status(kernel_slug)

        if status_result["status"] == "SUCCESS":
            consecutive_errors = 0
            output_lower = status_result["output"].lower()

            if "queued" in output_lower or "running" in output_lower:
                # Still processing
                pass
            elif "complete" in output_lower or "idle" in output_lower:
                # Finished successfully
                return {
                    "status": "COMPLETE",
                    "runtime_s": time.time() - start_time,
                }
            elif "error" in output_lower or "failed" in output_lower:
                # Kernel failed
                return {
                    "status": "FAILED",
                    "runtime_s": time.time() - start_time,
                    "error": status_result["output"][:300],
                }
        else:
            consecutive_errors += 1
            if consecutive_errors > 5:
                return {
                    "status": "NOT_FOUND",
                    "runtime_s": time.time() - start_time,
                    "error": "Kernel not accessible",
                }

        time.sleep(poll_interval)

    return {
        "status": "TIMEOUT",
        "runtime_s": timeout_seconds,
        "error": f"Did not complete in {timeout_seconds}s",
    }

def test_notebook(notebook_name):
    """Test a single notebook."""
    print(f"\n🧪 {notebook_name}")

    push_result = push_notebook(notebook_name)
    print(f"   Push: {push_result['status']}")

    if push_result["status"] != "PUSHED":
        print(f"      Error: {push_result.get('error', 'Unknown')[:150]}")
        return push_result

    kernel_slug = push_result["kernel_slug"]
    time.sleep(2)  # Wait for Kaggle to register

    print(f"   Running (max 300s)...")
    run_result = run_notebook_with_polling(kernel_slug, timeout_seconds=300)
    print(f"   Result: {run_result['status']} ({run_result.get('runtime_s', 0):.1f}s)")

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
    print("P3.09 REPAIRED NOTEBOOKS TEST v2")
    print("=" * 70)
    print(f"Testing {len(TEST_NOTEBOOKS)} notebooks (3 concurrent, unique IDs)\n")

    results = {}
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(test_notebook, nb): nb for nb in TEST_NOTEBOOKS}
        for future in as_completed(futures):
            nb_name = futures[future]
            try:
                results[nb_name] = future.result()
            except Exception as e:
                results[nb_name] = {
                    "notebook": nb_name,
                    "status": "ERROR",
                    "error": str(e)[:300],
                }

    # Summary
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)

    push_ok = sum(1 for r in results.values() if r.get("push") == "PUSHED")
    exec_ok = sum(1 for r in results.values() if r.get("execution") == "COMPLETE")

    for nb, result in sorted(results.items()):
        p = result.get("push", "?")
        e = result.get("execution", "?")
        rt = result.get("runtime_s", 0)
        emoji = "✅" if (p == "PUSHED" and e == "COMPLETE") else "❌"
        print(f"{emoji} {nb:48s} P:{p:15s} E:{e:10s} ({rt:6.1f}s)")

    print("\n" + "=" * 70)
    print(f"Pushed: {push_ok}/{len(TEST_NOTEBOOKS)}")
    print(f"Complete: {exec_ok}/{len(TEST_NOTEBOOKS)}")

    if push_ok >= 6 and exec_ok >= 5:
        print("\n✅ SUCCESS - Ready for full batch")
        return 0
    else:
        print("\n❌ FAILED")
        return 1

if __name__ == "__main__":
    sys.exit(main())
