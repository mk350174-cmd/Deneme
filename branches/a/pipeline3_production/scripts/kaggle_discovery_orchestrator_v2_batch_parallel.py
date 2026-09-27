#!/usr/bin/env python3
"""
P3.09 Kaggle Discovery Orchestrator v2 — Batch Parallel Execution

Executes 15 discovery notebooks in 3 batches of 5 parallel notebooks each.
- Batch 1: Notebooks 01-05 (parallel)
- Batch 2: Notebooks 06-10 (parallel)
- Batch 3: Notebooks 11-15 (parallel)

Each notebook: Hard 5-minute timeout, JSON evidence output.
Goal: Minimize total discovery time, empirically validate concurrency.
"""

import subprocess
import json
import time
import sys
import argparse
import threading
import shutil
import uuid
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed

class BatchParallelOrchestrator:
    """Orchestrate P3.09 Kaggle discovery testing with batch-parallel execution."""

    # 15 notebooks organized in 3 batches of 5 each
    NOTEBOOK_BATCHES = [
        # Batch 1: Foundational + Critical P3.09
        [
            "kaggle_discovery_01_gpu_capability_probe.ipynb",
            "kaggle_discovery_02_network_probe.ipynb",
            "kaggle_discovery_03_runtime_packages_probe.ipynb",
            "kaggle_discovery_05_parameter_passing.ipynb",
            "kaggle_discovery_06_secrets_credentials_probe.ipynb",
        ],
        # Batch 2: I/O + Render Capabilities
        [
            "kaggle_discovery_07_dataset_readwrite_probe.ipynb",
            "kaggle_discovery_08_output_retrieval_probe.ipynb",
            "kaggle_discovery_09_micro_remotion_probe.ipynb",
            "kaggle_discovery_10_ffmpeg_merge_probe.ipynb",
            "kaggle_discovery_11_worker_shard_probe.ipynb",
        ],
        # Batch 3: Orchestration + Authorization
        [
            "kaggle_discovery_12_concurrent_execution_probe.ipynb",
            "kaggle_discovery_13_failure_recovery_probe.ipynb",
            "kaggle_discovery_14_micro_e2e_probe.ipynb",
            "kaggle_discovery_15_api_authorization_probe.ipynb",
            "kaggle_discovery_00_discovery_framework.ipynb",  # Baseline last
        ],
    ]

    # Critical notebooks for verdict
    CRITICAL_NOTEBOOKS = {
        "kaggle_discovery_05_parameter_passing.ipynb": "Parameter Passing (BLOCKER)",
        "kaggle_discovery_09_micro_remotion_probe.ipynb": "Remotion Render (BLOCKER)",
        "kaggle_discovery_10_ffmpeg_merge_probe.ipynb": "FFmpeg Merge (BLOCKER)",
        "kaggle_discovery_08_output_retrieval_probe.ipynb": "Output Retrieval",
        "kaggle_discovery_14_micro_e2e_probe.ipynb": "E2E Proof",
    }

    def __init__(self, username: str, output_dir: str = "./kaggle_discovery_results", max_parallel: int = 5):
        self.username = username
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.max_parallel = max_parallel
        self.start_time = time.time()
        self.results: Dict[str, Any] = {
            "session_id": f"discovery_{int(time.time())}",
            "timestamp": datetime.now().isoformat(),
            "username": username,
            "execution_mode": "batch_parallel_5x3",
            "batches": [],
            "all_notebooks_results": [],
            "capability_findings": {},
            "critical_metrics": {},
            "final_verdict": "PENDING"
        }
        self.lock = threading.Lock()

    def log(self, msg: str, level: str = "INFO"):
        """Thread-safe logging with timestamp."""
        elapsed = time.time() - self.start_time
        prefix = f"[{int(elapsed):4d}s] [{level:6s}]"
        with self.lock:
            print(f"{prefix} {msg}")

    @staticmethod
    def title_to_slug(title: str) -> str:
        """Convert notebook title to Kaggle kernel slug (kebab-case)."""
        return title.lower().replace(' - ', '-').replace(' ', '-').replace('_', '-')

    def push_notebook(self, notebook_name: str) -> str:
        """Push discovery notebook to Kaggle using kernels push (not notebooks push)."""
        notebook_base = notebook_name.replace('.ipynb', '')
        # Use absolute path based on script location
        script_dir = Path(__file__).parent
        notebook_path = script_dir.parent / "notebooks" / notebook_name

        if not notebook_path.exists():
            self.log(f"Notebook not found: {notebook_path}", "ERROR")
            return None

        try:
            # Create kernel submission directory
            kernel_dir = Path(f"/tmp/kernel_{notebook_base}")
            kernel_dir.mkdir(parents=True, exist_ok=True)

            # Copy notebook
            shutil.copy(notebook_path, kernel_dir / "notebook.ipynb")

            # Create kernel metadata file with code_file specification
            # Use full UUID suffix to guarantee uniqueness and avoid 409 Conflict errors
            kernel_id_suffix = str(uuid.uuid4())[:8]
            # Title MUST match the slug - Kaggle validates this strictly
            slug_base = self.title_to_slug(notebook_base)
            notebook_title = f"{slug_base}-{kernel_id_suffix}".replace('-', ' ').title()

            metadata = {
                "id": f"{self.username}/{slug_base}-{kernel_id_suffix}",
                "title": notebook_title,
                "description": "P3.09 Kaggle Discovery Lab",
                "code_file": "notebook.ipynb",  # CRITICAL: must specify source file
                "language": "python",
                "kernel_type": "notebook",
                "enable_internet": True,
                "enable_gpu": False,
                "is_private": False
            }

            with open(kernel_dir / "kernel-metadata.json", 'w') as f:
                json.dump(metadata, f)

            # Push using kernels command (NOT notebooks command)
            result = subprocess.run(
                ["kaggle", "kernels", "push", "-p", str(kernel_dir)],
                capture_output=True,
                text=True,
                timeout=60
            )

            if result.returncode == 0:
                # Extract kernel slug from title (UUID suffix ensures uniqueness)
                kernel_slug = f"{self.username}/{self.title_to_slug(notebook_title)}-{kernel_id_suffix}"
                self.log(f"Pushed: {kernel_slug}", "PASS")
                return kernel_slug
            else:
                self.log(f"Push failed: {result.stderr[:100]}", "WARN")
                return None
        except Exception as e:
            self.log(f"Push error: {str(e)[:100]}", "ERROR")
            return None

    def run_notebook_with_timeout(self, notebook_slug: str, timeout_seconds: int = 300) -> Dict[str, Any]:
        """
        Monitor Kaggle kernel execution with hard timeout enforcement.

        After push, kernel runs automatically. Monitor status until COMPLETE or timeout.

        Args:
            notebook_slug: Kaggle kernel slug (username/slug)
            timeout_seconds: Hard timeout (default 5 minutes = 300 seconds)

        Returns:
            Execution result with status (completed, timeout, failed, error)
        """
        notebook_name = notebook_slug.split("/")[-1]
        self.log(f"[PARALLEL] Starting: {notebook_name}", "RUN")

        start_time = time.time()
        poll_interval = 2  # Check status every 2 seconds

        try:
            while True:
                elapsed = time.time() - start_time

                # Check if timeout exceeded
                if elapsed > timeout_seconds:
                    self.log(f"[PARALLEL] TIMEOUT: {notebook_name} (exceeded {timeout_seconds}s)", "TIMEOUT")
                    return {
                        "notebook_name": notebook_name,
                        "notebook_slug": notebook_slug,
                        "status": "timeout",
                        "elapsed_s": elapsed,
                        "error": f"Hard timeout after {timeout_seconds}s"
                    }

                # Poll kernel status
                result = subprocess.run(
                    ["kaggle", "kernels", "status", notebook_slug],
                    capture_output=True,
                    text=True,
                    timeout=10
                )

                status_output = result.stdout.strip()

                # Parse status
                if "COMPLETE" in status_output:
                    self.log(f"[PARALLEL] Completed: {notebook_name} ({elapsed:.1f}s)", "PASS")
                    return {
                        "notebook_name": notebook_name,
                        "notebook_slug": notebook_slug,
                        "status": "completed",
                        "elapsed_s": elapsed,
                        "status_output": status_output
                    }
                elif "FAILED" in status_output or "ERROR" in status_output:
                    self.log(f"[PARALLEL] Failed: {notebook_name} ({elapsed:.1f}s)", "FAIL")
                    return {
                        "notebook_name": notebook_name,
                        "notebook_slug": notebook_slug,
                        "status": "failed",
                        "elapsed_s": elapsed,
                        "status_output": status_output
                    }
                elif "RUNNING" in status_output or "QUEUED" in status_output:
                    # Still running, continue polling
                    pass
                else:
                    # Unknown status
                    self.log(f"[PARALLEL] Unknown status: {notebook_name} - {status_output[:50]}", "WARN")

                # Wait before next poll
                time.sleep(poll_interval)

        except subprocess.TimeoutExpired:
            elapsed = time.time() - start_time
            self.log(f"[PARALLEL] Status check timeout: {notebook_name} ({elapsed:.1f}s)", "TIMEOUT")
            return {
                "notebook_name": notebook_name,
                "notebook_slug": notebook_slug,
                "status": "timeout",
                "elapsed_s": elapsed,
                "error": "Status check timeout"
            }
        except Exception as e:
            elapsed = time.time() - start_time
            self.log(f"[PARALLEL] Exception: {notebook_name} ({elapsed:.1f}s)", "ERROR")
            return {
                "notebook_name": notebook_name,
                "notebook_slug": notebook_slug,
                "status": "error",
                "elapsed_s": elapsed,
                "error": str(e)[:500]
            }

    def retrieve_results(self, notebook_slug: str) -> Dict[str, Any]:
        """Retrieve results JSON and logs from executed kernel."""
        try:
            output_dir = self.output_dir / notebook_slug.replace("/", "_")
            output_dir.mkdir(parents=True, exist_ok=True)

            # Retrieve kernel output files (JSON evidence, etc.)
            result = subprocess.run(
                ["kaggle", "kernels", "output", notebook_slug, "-p", str(output_dir)],
                capture_output=True,
                text=True,
                timeout=60
            )

            if result.returncode == 0:
                # Find JSON result files
                json_files = list(output_dir.glob("discovery_*_results.json"))
                if json_files:
                    with open(json_files[0]) as f:
                        json_data = json.load(f)
                        # Add retrieval success indicator
                        json_data["_retrieval_status"] = "success"
                        return json_data
                else:
                    return {"status": "no_results_json", "_retrieval_status": "failed"}
            else:
                return {"status": "retrieval_failed", "_retrieval_status": "failed", "error": result.stderr[:200]}
        except Exception as e:
            return {"status": "error", "_retrieval_status": "failed", "error": str(e)}

    def execute_batch_parallel(self, batch_index: int, notebook_names: List[str]) -> List[Dict[str, Any]]:
        """
        Execute a batch of 5 notebooks in parallel.

        Args:
            batch_index: 0-indexed batch number
            notebook_names: List of notebook filenames to run in parallel

        Returns:
            List of execution results
        """
        batch_num = batch_index + 1
        self.log(f"================ BATCH {batch_num} START ================", "BATCH")
        self.log(f"Executing {len(notebook_names)} notebooks in parallel", "INFO")

        batch_results = []

        # Phase 1: Push all notebooks in batch (with delays to avoid rate limiting)
        notebook_slugs = {}
        for i, nb_name in enumerate(notebook_names):
            slug = self.push_notebook(nb_name)
            if slug:
                notebook_slugs[nb_name] = slug
            else:
                self.log(f"Failed to push: {nb_name}", "ERROR")
            # Add delay between pushes to avoid Kaggle API rate limiting
            if i < len(notebook_names) - 1:
                time.sleep(2)

        # Phase 2: Execute all in batch in parallel
        with ThreadPoolExecutor(max_workers=self.max_parallel) as executor:
            futures = {
                executor.submit(self.run_notebook_with_timeout, slug, timeout_seconds=300): slug
                for nb_name, slug in notebook_slugs.items()
            }

            for future in as_completed(futures):
                execution_result = future.result()
                batch_results.append(execution_result)

                # Attempt to retrieve results
                if execution_result["status"] in ["completed", "failed"]:
                    notebook_results = self.retrieve_results(execution_result["notebook_slug"])
                    execution_result["notebook_results"] = notebook_results

        self.log(f"================ BATCH {batch_num} COMPLETE ================", "BATCH")
        self.log(f"Batch {batch_num}: {len(batch_results)} notebooks executed", "INFO")

        return batch_results

    def execute_discovery_suite(self):
        """Execute complete discovery notebook suite (3 batches)."""
        self.log("=" * 70, "START")
        self.log("P3.09 KAGGLE DISCOVERY SUITE — BATCH PARALLEL EXECUTION", "START")
        self.log(f"Mode: 3 batches × 5 parallel notebooks (timeout: 300s each)", "START")
        self.log("=" * 70, "START")

        for batch_index, notebook_batch in enumerate(self.NOTEBOOK_BATCHES):
            batch_results = self.execute_batch_parallel(batch_index, notebook_batch)
            self.results["batches"].append({
                "batch_index": batch_index,
                "batch_number": batch_index + 1,
                "notebooks": len(notebook_batch),
                "results": batch_results
            })
            self.results["all_notebooks_results"].extend(batch_results)

            # Wait before next batch
            if batch_index < len(self.NOTEBOOK_BATCHES) - 1:
                self.log(f"Waiting 10s before next batch...", "INFO")
                time.sleep(10)

        self.generate_final_report()

    def generate_final_report(self):
        """Generate comprehensive capability matrix and final verdict."""
        self.log("=" * 70, "REPORT")
        self.log("Aggregating discovery results and generating reports...", "INFO")

        # Analyze all results
        passed = sum(1 for r in self.results["all_notebooks_results"] if r.get("status") == "completed")
        failed = sum(1 for r in self.results["all_notebooks_results"] if r.get("status") == "failed")
        timeout = sum(1 for r in self.results["all_notebooks_results"] if r.get("status") == "timeout")
        errors = sum(1 for r in self.results["all_notebooks_results"] if r.get("status") == "error")

        # Analyze critical metrics
        critical_pass = 0
        for nb_name, desc in self.CRITICAL_NOTEBOOKS.items():
            results_for_nb = [r for r in self.results["all_notebooks_results"] if nb_name in r.get("notebook_name", "")]
            if results_for_nb and results_for_nb[0].get("status") == "completed":
                critical_pass += 1
                self.results["critical_metrics"][desc] = "PASS"
            else:
                self.results["critical_metrics"][desc] = "FAIL/TIMEOUT"

        # Determine final verdict
        total = len(self.results["all_notebooks_results"])
        if critical_pass >= 5:
            self.results["final_verdict"] = "GO"
        elif critical_pass >= 3:
            self.results["final_verdict"] = "CONDITIONAL"
        else:
            self.results["final_verdict"] = "NO-GO"

        # Save comprehensive report
        report_path = self.output_dir / "KAGGLE_DISCOVERY_RESULTS.json"
        report_path.write_text(json.dumps(self.results, indent=2))

        # Generate markdown capability matrix
        self._generate_capability_matrix()

        # Generate final decision document
        self._generate_decision_document()

        self.log("=" * 70, "RESULT")
        self.log(f"Verdict: {self.results['final_verdict']}", "RESULT")
        self.log(f"Results: {passed} PASS, {failed} FAIL, {timeout} TIMEOUT, {errors} ERROR", "RESULT")
        self.log(f"Critical Metrics: {critical_pass}/5", "RESULT")
        self.log(f"Report: {report_path}", "RESULT")
        self.log("=" * 70, "RESULT")

    def _generate_capability_matrix(self):
        """Generate KAGGLE_CAPABILITY_MATRIX.md"""
        matrix_path = Path("KAGGLE_CAPABILITY_MATRIX.md")

        passed = sum(1 for r in self.results["all_notebooks_results"] if r.get("status") == "completed")
        timeout = sum(1 for r in self.results["all_notebooks_results"] if r.get("status") == "timeout")
        total = len(self.results["all_notebooks_results"])

        matrix_content = f"""# P3.09 Kaggle Capability Matrix

**Generated:** {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
**Discovery Session:** {self.results["session_id"]}
**Execution Mode:** Batch Parallel (3 batches × 5 notebooks)
**Timeout:** 300 seconds per notebook
**Final Verdict:** {self.results["final_verdict"]}

## Critical Success Metrics (5 Must-Pass)

| # | Capability | Status | Risk |
|---|---|---|---|
| 1 | Parameter Passing (Notebook 05) | {self.results["critical_metrics"].get("Parameter Passing (BLOCKER)", "?")} | CRITICAL |
| 2 | Remotion Rendering (Notebook 09) | {self.results["critical_metrics"].get("Remotion Render (BLOCKER)", "?")} | CRITICAL |
| 3 | FFmpeg Merge (Notebook 10) | {self.results["critical_metrics"].get("FFmpeg Merge (BLOCKER)", "?")} | CRITICAL |
| 4 | Output Retrieval (Notebook 08) | {self.results["critical_metrics"].get("Output Retrieval", "?")} | HIGH |
| 5 | E2E Proof (Notebook 14) | {self.results["critical_metrics"].get("E2E Proof", "?")} | HIGH |

## Summary

- **Total Notebooks Executed:** {total}
- **Completed Successfully:** {passed}
- **Timeout/Failed:** {timeout}
- **Critical Metrics Passing:** {sum(1 for v in self.results["critical_metrics"].values() if v == "PASS")}/5

## Verdict: {self.results["final_verdict"]}

- GO: All 5 critical metrics PASS → Production implementation approved
- CONDITIONAL: 3-4 metrics PASS → Production with contingencies
- NO-GO: <3 metrics PASS → Defer distributed render strategy

See `KAGGLE_P3_09_PRODUCTION_DECISION.md` for detailed analysis.
"""

        matrix_path.write_text(matrix_content)
        self.log(f"Capability matrix: {matrix_path}", "INFO")

    def _generate_decision_document(self):
        """Generate KAGGLE_P3_09_PRODUCTION_DECISION.md"""
        decision_path = Path("KAGGLE_P3_09_PRODUCTION_DECISION.md")

        decision_content = f"""# P3.09 Kaggle Distributed Render — Production Decision

**Date:** {datetime.now().strftime("%Y-%m-%d")}
**Empirical Testing:** Kaggle Discovery Lab (Batch Parallel Mode)
**Execution Mode:** 3 batches × 5 parallel notebooks (300s timeout each)
**Session ID:** {self.results["session_id"]}
**Final Verdict:** {self.results["final_verdict"]}

## Critical Success Metrics

| # | Metric | Status |
|---|--------|--------|
| 1 | Parameter Passing | {self.results["critical_metrics"].get("Parameter Passing (BLOCKER)", "?")} |
| 2 | Remotion Rendering | {self.results["critical_metrics"].get("Remotion Render (BLOCKER)", "?")} |
| 3 | FFmpeg Merge | {self.results["critical_metrics"].get("FFmpeg Merge (BLOCKER)", "?")} |
| 4 | Output Retrieval | {self.results["critical_metrics"].get("Output Retrieval", "?")} |
| 5 | E2E Proof | {self.results["critical_metrics"].get("E2E Proof", "?")} |

## Decision

**Verdict:** {self.results["final_verdict"]}

### If GO
P3.09 Phase 1 implementation approved immediately.

### If CONDITIONAL
Phase 1 approved with documented contingencies for failing metrics.

### If NO-GO
Distributed render deferred; single-machine render remains primary.

---

See `KAGGLE_CAPABILITY_MATRIX.md` for detailed findings.
"""

        decision_path.write_text(decision_content)
        self.log(f"Decision document: {decision_path}", "INFO")

def main():
    parser = argparse.ArgumentParser(
        description="P3.09 Kaggle Discovery Orchestrator v2 (Batch Parallel Execution)"
    )
    parser.add_argument("--kaggle-username", required=True, help="Kaggle username")
    parser.add_argument("--output-dir", default="./kaggle_discovery_results", help="Output directory")
    parser.add_argument("--max-parallel", type=int, default=5, help="Max parallel notebooks per batch")

    args = parser.parse_args()

    orchestrator = BatchParallelOrchestrator(
        args.kaggle_username,
        args.output_dir,
        args.max_parallel
    )
    orchestrator.execute_discovery_suite()

    return 0 if orchestrator.results["final_verdict"] != "NO-GO" else 1

if __name__ == "__main__":
    sys.exit(main())
