# @SmokeTest Analysis for Fenix AndroidTest

This document provides analysis of `@SmokeTest` annotated instrumented Android tests in the Fenix app.

## Current Count

**Total @SmokeTest annotated instrumented androidTest tests: 153**

## What is @SmokeTest?

The `@SmokeTest` annotation is a custom annotation defined in:
`app/src/androidTest/java/org/mozilla/fenix/customannotations/SmokeTest.kt`

According to the annotation documentation, it marks smoke tests corresponding to the ones in TestRail:
https://testrail.stage.mozaws.net/index.php?/suites/view/3192

## Test Distribution

The tests are distributed across 44 different test files in the `app/src/androidTest/` directory.

### Top 10 files with most @SmokeTest annotations:

1. **MainMenuTestCompose.kt** - 28 tests
2. **SearchTest.kt** - 9 tests  
3. **NavigationToolbarTest.kt** - 6 tests
4. **BookmarksTest.kt** - 6 tests
5. **TranslationsTest.kt** - 5 tests
6. **TextSelectionTest.kt** - 5 tests
7. **MainMenuTest.kt** - 5 tests
8. **CollectionTest.kt** - 5 tests
9. **TabbedBrowsingTest.kt** - 4 tests
10. **SettingsSitePermissionsTest.kt** - 4 tests

## Automated Counting

You can use the provided script to get updated counts:

```bash
./scripts/count_smoketest_annotations.sh
```

This script will:
- Count total @SmokeTest annotations in androidTest files
- Provide a breakdown by test file
- Show the top files with the most annotations

## Verification

All tests have been verified to be proper instrumented Android tests by confirming they:
- Are located in the `androidTest` source set
- Use `androidx.test` framework imports
- Follow Android instrumented test patterns

---

*Last updated: Generated programmatically from repository analysis*