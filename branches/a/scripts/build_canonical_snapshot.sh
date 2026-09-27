#!/usr/bin/env bash
# Builds A_BRANCH_FULL_PIPELINE_P1_TO_P3_CANONICAL.zip from the current
# working tree. Fixes a real defect found in an earlier ad-hoc packaging
# command: it did not exclude Python generated artifacts, so
# pipeline3_production/scripts/__pycache__/*.pyc leaked into a prior
# snapshot ZIP. This script is the single source of truth for what a
# canonical snapshot should and should not contain — re-run it rather than
# hand-writing a new `find | zip` command.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

ZIP_NAME="A_BRANCH_FULL_PIPELINE_P1_TO_P3_CANONICAL.zip"
rm -f "$ZIP_NAME"

find pipeline1_research pipeline2_creative pipeline3_production docs scripts \
  REPRODUCE_A_BRANCH.md FULL_PIPELINE_SYSTEM_MAP.md FULL_PIPELINE_CANONICAL_MANIFEST.md \
  A_BRANCH_FINAL_CANONICAL_MANIFEST.md A_BRANCH_SNAPSHOT_MANIFEST.md \
  A_BRANCH_CANONICALIZATION_REPORT.md A_BRANCH_RECONCILED_MASTER_PLAN.md \
  A_BRANCH_REPAIR_EXECUTION_REPORT.md A_BRANCH_REPAIR_PART1_PART2_RECONCILIATION.md \
  A_BRANCH_TIER1_TIER2_REPAIR_REPORT.md A_P1_CATEGORY2_FINAL_DESIGN.md \
  A_P1_CATEGORY4_PLAN.md A_P1_CATEGORY5_PLAN.md \
  A_BRANCH_OPUS5_REPAIR_REPORT.md \
  A_BRANCH_GPT56_FINAL_REPAIR_REPORT.md A_BRANCH_CANONICAL_MANIFEST_20260906_FINAL.md \
  -type f \
  ! -path "*/node_modules/*" \
  ! -path "*/.git/*" \
  ! -path "*/dist/*" \
  ! -path "*/.vitest/*" \
  ! -path "*/build/*" \
  ! -path "*/.turbo/*" \
  ! -path "*/__pycache__/*" \
  ! -name "*.pyc" \
  ! -path "*/.pytest_cache/*" \
  ! -path "*/.mypy_cache/*" \
  ! -path "*/.ipynb_checkpoints/*" \
  ! -name ".DS_Store" \
  ! -name "*.log" \
  ! -name "*.env" \
  ! -name "production_audio_*.wav" \
  -print0 | xargs -0 zip -q "$ZIP_NAME"

echo "Built: $ZIP_NAME"
echo "Size:  $(wc -c < "$ZIP_NAME") bytes"
echo "Files: $(unzip -l "$ZIP_NAME" | tail -1 | awk '{print $2}')"
echo "SHA-256: $(sha256sum "$ZIP_NAME" | cut -d' ' -f1)"
echo
echo "Verifying no generated artifacts leaked in:"
if unzip -l "$ZIP_NAME" | grep -qiE "__pycache__|\.pyc$|\.pytest_cache|\.mypy_cache|ipynb_checkpoints|\.DS_Store|\.log$"; then
  echo "FAIL: generated artifacts found in the ZIP:"
  unzip -l "$ZIP_NAME" | grep -iE "__pycache__|\.pyc$|\.pytest_cache|\.mypy_cache|ipynb_checkpoints|\.DS_Store|\.log$"
  exit 1
else
  echo "PASS: no __pycache__/.pyc/cache/.DS_Store/.log entries found."
fi

echo
echo "Verifying ZIP integrity:"
unzip -t "$ZIP_NAME" | tail -1
