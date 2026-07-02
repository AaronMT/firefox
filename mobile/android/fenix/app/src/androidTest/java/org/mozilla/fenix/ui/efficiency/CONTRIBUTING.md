# Contributing to the TAE Test Framework

## Principles

### Tests declare what, not how

A test should read as a specification of behavior. Navigation mechanics, element resolution, retries, and waits belong in the framework. If someone reads your test and can't tell what feature it validates within 10 seconds, rewrite it.

### One test, one assertion

If you have assertion blocks separated by navigation or interaction steps, you have written multiple tests glued together. Split them. Use `mozVerifyElementsByGroup` to assert multiple related elements as one logical check when they belong to the same verification.

### Three-phase structure

Every test follows this pattern:

```kotlin
// SETUP: what preconditions does this test need?
// Prefer BaseTest constructor flags, pre-seeded data, or pre-runner state.
// Reserve in-test setup for state that genuinely requires UI interaction.
createBookmarkItem(url, title, null)

// STEPS: navigation and page object interactions to reach the point of interest.
on.bookmarks.navigateToPage()
    .openItemMenu(title)
    .mozClick(BookmarksSelectors.SHARE_BUTTON)

// ASSERT: a single assertion block capturing the spirit of the test.
// This is WHY the test exists and WHAT artifact is being verified.
on.shareOverlay.mozVerifyElementsByGroup("shareTabLayout")
```

Push setup as early as possible. If state can be configured via feature flags in the `BaseTest` constructor, do that. If it can be set before the runner initializes (intent extras, shared prefs), do that.

## The three test types

Before writing a test, identify which type it is. Each has a repeatable model:

**Presence** - Navigate to a surface, verify elements render. No state changes. Answers: *"Does this page show what it should?"*
```kotlin
on.home.navigateToPage()
    .mozVerifyElementsByGroup("requiredForPage")
```

**Interaction** - Navigate + perform an action + verify the immediate result. Modifies state on one surface. Answers: *"Does this control do what it should?"*
```kotlin
on.home.navigateToPage()
    .mozClick(HomeSelectors.PRIVATE_BROWSING_BUTTON)
on.home.mozVerifyElementsByGroup("privateBrowsing")
```

**Behavior** - One or more state changes across one or more pages. Answers: *"Does this feature work end-to-end?"* These compose presence and interaction primitives.
```kotlin
on.browserPage.navigateToPage(url)
on.home.navigateToPage()
    .mozVerifyElementsByGroup("jumpBackIn")
```

If you can't classify your test, you don't yet have a clear enough picture of what you're testing.

## Reuse over specificity

### Write for reuse by default

Before adding a function, ask: "Would another test for a different feature need this?" If yes, it belongs in a page object or shared step. If no, reconsider whether you need a new function at all.

### Page objects are shared vocabulary

If you add a method to a page object, it should be useful to any test touching that page. If only your test calls it, it doesn't belong there.

### Test steps belong on the page they operate on

A page object method should only interact with the UI surface it represents. If a method on `BrowserPage` clicks through MainMenu and Collections selectors, it's crossing page boundaries -- put it on the page where the action starts, or split it across the relevant page objects. Similarly, don't chain primitives on one page object while interacting with another page's UI just because the return type allows it.

### Selectors are shared vocabulary too

Define selectors once in the appropriate `selectors/*Selectors.kt` file. Assign meaningful groups. Don't create one-off selectors inline in tests.

## Primitives and test steps

### Use the existing primitives

`mozClick`, `mozSwipe`, `mozVerify`, `mozVerifyElement`, `mozVerifyElementsByGroup`, `mozEnterText`, `mozPressEnter` -- these are your building blocks. Compose tests from them.

| Primitive | Purpose |
|-----------|---------|
| `mozClick(selector)` | Click an element |
| `mozLongClick(selector)` | Long-click an element |
| `mozSwipeTo(selector)` | Swipe to make an element visible |
| `mozEnterText(text, selector)` | Enter text into a field |
| `mozClearAndEnterText(text, selector)` | Clear then enter text |
| `mozPressEnter()` | Press the IME enter key |
| `mozVerify(selector)` | Verify a single element is displayed |
| `mozVerifyElement(selector)` | Verify with additional options |
| `mozVerifyElementsByGroup(group)` | Verify all selectors in a group |
| `mozVerifyElementAbsent(selector)` | Verify element is not displayed |
| `navigateToPage()` | Navigate via the navigation graph |

### Do not extend BasePage

Don't add new primitives to `BasePage.kt` unless you've identified a genuinely missing *category* of interaction that multiple pages need. The bar for adding to BasePage is high.

### Don't create framework-level abstractions

No `clickAndWaitForBookmarks()` -- that's `mozClick` + `navigateToPage`. No `interactAndWait()` -- that's a primitive trying to be a framework. These belong in BasePage if anywhere.

### Custom commands over custom waits

If you're tempted to write a new wait/polling mechanism, you probably need a better selector (one that keys off the right element state) rather than new timing logic.

### When to wrap primitives into page object test steps

Page object methods are test steps. The structured log hierarchy is `[STEP]` > `[CMD]` > `[LOC]` > `[SEL]`, and test steps should read like steps in a TestRail test case. The question isn't "how many primitives does it wrap?" but "does wrapping improve logging and root cause analysis?"

**Wrap when:**
- The method name maps to a recognizable user action that would appear as a TestRail step (e.g., `openMainMenu`, `openItemMenu`, `saveEditBookmark`)
- A `[STEP]`-level failure in the log would immediately tell you what user action broke -- without reading the underlying `[CMD]`s -- with close to zero processing effort
- The grouping represents a logical user action, even if it's one primitive today

**Don't wrap when:**
- The wrapper name doesn't add clarity beyond primitive + selector (e.g., `verifyBookmarkTitle(title)` vs `mozVerify(BookmarksSelectors.BOOKMARK_ITEM(title))` -- these read identically)
- You're wrapping just to avoid typing the selector object name

This matters because the structured logging is designed as a bidirectional bridge to TestRail: well-named test steps, commands, locators, and selectors mean TestRail cases can generate tests via factories, and test logging can maintain TestRail cases. AI can also generate test scaffolding from selectors, navigation nodes, and page object test steps. This flow only works when each layer is meaningful and reads like a test case.

## Selectors and element strategy

### Choose stable anchors

Selectors should represent stable, semantic anchors: test tags, resource IDs, accessibility labels. Avoid selectors tied to layout position, localized text, or internal implementation details.

### Use groups to express intent

- `"requiredForPage"` -- elements that prove the page loaded
- `"jumpBackIn"`, `"topSitesCompose"` -- elements that constitute a feature area
- `"homeScreen"` -- elements belonging to a broader surface

Groups turn element lists into meaningful assertions.

### Groups are for static elements; use multiple `mozVerify` calls for dynamic data

`mozVerifyElementsByGroup` works with selectors defined at compile time in the selectors file. When values come from test data at runtime (e.g., verifying that specific page titles appear in a collection), use individual `mozVerify` calls with parameterized selectors. Multiple `mozVerify` calls in the same assertion block on the same page is fine -- it's not the same anti-pattern as splitting assertions across navigation.

### Prefer existing selector strategies

The 20+ strategies in `SelectorStrategy` cover Compose, Espresso, and UIAutomator. If none works, the UI itself may need a test hook (a test tag or content description) rather than a more complex selector.

## Navigation

### Use the registry

All navigation goes through `navigateToPage()`. Hard-coded click sequences to reach a page mean the registry is missing an edge -- add the edge, don't work around it.

### Register edges in page object init blocks

This keeps the graph definition co-located with the page that owns the relationship:

```kotlin
class HomePage(...) : BasePage(composeRule) {
    override val pageName = "HomePage"

    init {
        NavigationRegistry.register(
            from = "AppEntry",
            to = pageName,
            steps = listOf(),
        )
        NavigationRegistry.register(
            from = pageName,
            to = "MainMenuPage",
            steps = listOf(NavigationStep.Click(HomeSelectors.MAIN_MENU_BUTTON)),
        )
    }
}
```

### Navigation is not a test step

Getting to the page is infrastructure. Your test starts once you're *on* the page. If navigation dominates your test body, your test is too far from its subject.

## Anti-patterns

These should be flagged in code review:

| Anti-pattern | Why it's wrong | What to do instead |
|---|---|---|
| Assertions interleaved with navigation | Multiple tests combined into one | Split into separate tests |
| New methods on BasePage | Framework bloat | Use existing primitives |
| Inline selectors in test files | Not reusable | Add to selectors file with groups |
| `Thread.sleep()` or custom polling | Brittle, flaky | Use `requiredForPage` or existing waits |
| Wrappers that don't add log clarity | Name doesn't aid root cause analysis | Use the primitive + selector directly |
| UI setup when config is available | Slower, flakier | Use constructor flags or pre-seeded data |
| Journey tests without foundational coverage | Premature | Write presence/interaction tests first |
| Framework-level abstractions in page objects | Belongs in BasePage if anywhere | Keep page object methods as test steps, not new primitives |
| Page object methods crossing page boundaries | Breaks page object model | Put methods on the page they operate on, or use separate `on.<page>` calls |
| Using `mozVerifyElementsByGroup` for dynamic data | Groups are compile-time; dynamic values won't match | Use individual `mozVerify` calls with parameterized selectors |
| Using `@After` for critical state cleanup | If the runner crashes, `@After` is not called -- leaves dirty state that can break subsequent tests or worse, cause false passes from carried-over state | Push cleanup to pre-test setup, constructor flags, or runner-level mechanisms that run regardless of crash |
| Handling unexpected popups in test assertions | System alerts, permission dialogs, and conditional modals break tests that aren't meant to verify them | Let custom commands handle view-blocking elements via fallback conditional checks -- this keeps the fix in one place (the primitive) rather than scattered across tests |

## Handling unexpected popups and system dialogs

Tests that aren't specifically verifying a popup, alert, or modal should not fail because one appeared unexpectedly. The framework's custom commands are designed to handle this: locators inside primitives can include fallback checks for view-blocking elements (system alerts, client popups, app modals) in priority order.

Don't add popup handling logic to individual tests. If a system dialog or conditional modal is blocking your test:
- If it appears reliably, suppress it via configuration (e.g., `isPageLoadTranslationsPromptEnabled = false` in the BaseTest constructor)
- If it appears sometimes, the custom command that encounters it should handle the dismissal -- one fix in one place
- If it requires state detection (e.g., permission state determines whether a dialog appears), use that state to drive conditional checks within the primitive, not the test

The goal is stability first, speed second. Adding conditional checks for view-blocking elements in custom commands is acceptable overhead -- it's cheaper than flaky tests.

## Before you write: checklist

1. What type of test is this? (Presence / Interaction / Behavior)
2. What is the single assertion that captures why this test exists?
3. Can the setup be pushed to constructor flags or pre-runner state?
4. Do the selectors I need already exist? Are they in the right groups?
5. Do the page object methods (test steps) I need already exist?
6. For any new test step: does the method name create a meaningful `[STEP]` in the log? Would a failure at that level immediately tell you what broke?
7. If I removed all the navigation, does the test body still make sense as a spec?

## Adding a new page

1. Create selectors in `selectors/NewPageSelectors.kt` with groups (at minimum `"requiredForPage"`)
2. Create page object in `pageObjects/NewPage.kt` extending `BasePage`
3. Register navigation edges in `init {}`
4. Implement `mozGetSelectorsByGroup()`
5. Add page instance to `helpers/PageContext.kt`
