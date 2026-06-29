# TAE (Test Automation Efficiency) Framework

## What this is

A declarative, graph-based UI test framework for Fenix. Tests express *what* is validated; the framework handles *how* (navigation, element resolution, retries, logging).

## Key rules for AI agents

- Never add methods to `helpers/BasePage.kt` unless a genuinely new *category* of interaction is needed across multiple pages. The bar is high.
- Never create single-use helper functions. Use the existing primitives: `mozClick`, `mozSwipe`, `mozVerify`, `mozVerifyElement`, `mozVerifyElementsByGroup`, `mozEnterText`, `mozPressEnter`.
- Never define selectors inline in test files. Add them to the appropriate `selectors/*Selectors.kt` file with meaningful `groups`.
- Never use `Thread.sleep()` or custom polling loops. Use `requiredForPage` selectors or existing wait primitives.
- Never bypass the navigation registry. If a path is missing, add an edge in the page object's `init {}` block.
- Never write journey/flow tests before the foundational presence and interaction tests exist for each surface involved.
- Do not use emoji in code or comments.

## Three test types

Know which you are writing before you start:

1. **Presence** - Navigate to a surface, verify elements render. No state changes.
2. **Interaction** - Navigate + action + verify immediate result. Modifies state on one surface.
3. **Behavior** - One or more state changes across one or more pages.

## Test structure (three-phase)

```kotlin
// SETUP: preconditions (prefer BaseTest constructor flags or pre-seeded data)
createBookmarkItem(url, title, null)

// STEPS: navigation and interaction to reach the point of interest
on.bookmarks.navigateToPage()
    .openItemMenu(title)
    .mozClick(BookmarksSelectors.SHARE_BUTTON)

// ASSERT: single assertion block capturing why this test exists
on.shareOverlay.mozVerifyElementsByGroup("shareTabLayout")
```

One test, one assertion block. If assertions are separated by navigation, split into separate tests.

## File organization

| Directory | Purpose |
|-----------|---------|
| `helpers/` | Framework infrastructure (BaseTest, BasePage, Selector, PageContext) |
| `selectors/` | UI element descriptors grouped by page |
| `pageObjects/` | Page classes with navigation edges and page-specific methods |
| `tests/` | Hand-written test classes |
| `navigation/` | Navigation graph, path-finding, sharded navigation tests |
| `factory/` | PresenceFactory, InteractionFactory, BehaviorFactory |
| `logging/` | Structured TimedReporter with STEP/CMD/LOC hierarchy |

## Adding a new page

1. Create selectors in `selectors/NewPageSelectors.kt` with groups (at minimum `"requiredForPage"`)
2. Create page object in `pageObjects/NewPage.kt` extending `BasePage`
3. Register navigation edges in `init {}`
4. Implement `mozGetSelectorsByGroup()`
5. Add page instance to `helpers/PageContext.kt`

## Adding a new test

1. Extend `BaseTest` with feature flags if needed
2. Use `on.<page>.navigateToPage()` to move
3. Chain primitives: `.mozClick()`, `.mozVerify()`, `.mozVerifyElementsByGroup()`
4. Keep test body minimal; logging happens automatically

## Running tests

```shell
./mach test mobile/android/fenix/app/src/androidTest/java/org/mozilla/fenix/ui/efficiency/tests/HomeTest.kt --headless
```

Redirect output to `artifacts/` instead of piping through `tail`/`grep`/`head`.

## Primitives reference

- `mozClick(selector)` - Click an element
- `mozLongClick(selector)` - Long-click an element
- `mozSwipeTo(selector)` - Swipe to make an element visible
- `mozEnterText(text, selector)` - Enter text into a field
- `mozClearAndEnterText(text, selector)` - Clear field then enter text
- `mozPressEnter()` - Press the IME enter key
- `mozVerify(selector)` - Verify a single element is displayed
- `mozVerifyElement(selector)` - Verify element with more options
- `mozVerifyElementsByGroup(group)` - Verify all selectors in a named group
- `mozVerifyElementAbsent(selector)` - Verify element is not displayed
- `navigateToPage()` - Navigate to this page via the navigation graph
