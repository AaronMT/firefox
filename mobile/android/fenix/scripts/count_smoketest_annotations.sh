#!/bin/bash

# Script to count @SmokeTest annotated instrumented androidTest tests in Fenix
# Usage: ./count_smoketest_annotations.sh

FENIX_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_TEST_DIR="$FENIX_ROOT/app/src/androidTest"

echo "Counting @SmokeTest annotations in Fenix androidTest files..."
echo "==============================================================="
echo

# Check if androidTest directory exists
if [ ! -d "$ANDROID_TEST_DIR" ]; then
    echo "Error: androidTest directory not found at $ANDROID_TEST_DIR"
    exit 1
fi

# Count total @SmokeTest annotations
total_count=$(grep -r "@SmokeTest" "$ANDROID_TEST_DIR" --include="*.kt" | wc -l)

echo "Total @SmokeTest annotated tests: $total_count"
echo

# Show breakdown by file
echo "Breakdown by test file:"
echo "-----------------------"
grep -r "@SmokeTest" "$ANDROID_TEST_DIR" --include="*.kt" | \
    cut -d: -f1 | \
    sort | \
    uniq -c | \
    sort -nr | \
    while read count file; do
        filename=$(basename "$file")
        printf "%3d  %s\n" "$count" "$filename"
    done

echo
echo "Analysis completed."
echo "Script location: $(realpath "${BASH_SOURCE[0]}")"