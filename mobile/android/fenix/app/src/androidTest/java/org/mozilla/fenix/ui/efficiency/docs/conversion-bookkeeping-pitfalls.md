# Pitfall: the `@Converted` pointer that quietly goes stale

When you convert a legacy test you leave a `@Converted` annotation on it pointing at the TAE test
that replaces it. That pointer is a **string**. Nothing dereferences it, nothing compiles against it,
and nothing fails when it is wrong. It is the one artifact of a conversion that can rot silently.

This document is the catalogue of how it rots, using the cases actually in the tree today.

## Why nothing catches it

`customannotations/Converted.kt` documents the guarantee:

> Every entry must resolve to a real, non-`@Ignore`d `@Test` method — validated at build time by the
> conversion lint check.

**There is no such lint check in the tree.** `replacedBy` appears nowhere outside `androidTest`; no
mozlint linter, detekt rule, or Gradle task reads it. The annotation is `documentation-only at
runtime` exactly as its KDoc says, and the sentence promising validation describes something that was
never built. So the guarantee you are relying on when you write the pointer does not exist, and a
typo survives review, lands, and stays.

The cost is not cosmetic. The pointer is what tells the next person that a legacy test is safe to
delete. A wrong pointer either blocks a deletion that should happen, or green-lights one that
shouldn't.

## The four failure modes

| Mode                | What it looks like                                       | Caught by a naive "does it exist" check? |
| ------------------- | -------------------------------------------------------- | ---------------------------------------- |
| **Wrong class**     | method name right, class name wrong or never existed      | Yes                                      |
| **Missing method**  | nothing in the TAE suite has that name                    | Yes                                      |
| **Points at @Ignore** | resolves, but the replacement is disabled                | Yes                                      |
| **Wrong target**    | resolves to a real live test — the *wrong* one            | **No**                                   |

The last one is the dangerous one, and it is the one in the tree right now. A pointer that resolves
is not a pointer that is correct.

---

## Example 1 — wrong class (the class never existed)

`ui/AddressAutofillTest.kt`:

```kotlin
// TestRail link: https://mozilla.testrail.io/index.php?/cases/view/3205329
@Converted(
    replacedBy = ["org.mozilla.fenix.ui.efficiency.tests.AutofillTest#verifyAddressAutofillTest"],
    since = "2026-07",
)
@SmokeTest
@Test
fun verifyAddressAutofillTest() {
```

There is no `AutofillTest` in `ui/efficiency/tests`. There is `AddressAutofillTest`,
`CreditCardAutofillTest` and `SettingsAutofillTest`. The method `verifyAddressAutofillTest` exists and
is correct — only the class was shortened.

Note the giveaway sitting six lines below it in the same file: the next `@Converted` in
`AddressAutofillTest.kt` points at `AddressAutofillTest#deleteSavedAddressTest` and is right. The two
annotations disagree about what the class is called.

**Fix:** `...tests.AddressAutofillTest#verifyAddressAutofillTest`.

## Example 2 — wrong class *and* wrong method

`ui/SettingsHomepageTest.kt`:

```kotlin
// TestRail link: https://mozilla.testrail.io/index.php?/cases/view/1564999
@Converted(
    replacedBy = ["org.mozilla.fenix.ui.efficiency.tests.SettingsHomepageTest#verifyJumpBackInSectionTest"],
    bug = 2042363,
    since = "2026-05",
)
@SmokeTest
@Test
fun jumpBackInOptionTest() {
```

Both halves are wrong:

- TAE's `SettingsHomepageTest` has no `verifyJumpBackInSectionTest`.
- A `verifyJumpBackInSectionTest` does exist — in `HomeTest` — and it is a **different test**. It
  verifies the Jump back in section *appears*. It is already legitimately claimed by
  `ui/HomeScreenTest.kt`.
- The legacy test here is the *settings toggle* test: turn the option off, confirm the section goes
  away.

The correct replacement was sitting under the matching name the whole time —
`SettingsHomepageTest#jumpBackInOptionTest` in TAE does exactly that:

```kotlin
fun jumpBackInOptionTest() {
    val genericURL = mockWebServer.getGenericAsset(1)

    on.browserPage.navigateToPage(genericURL.url.toString())
    on.home.navigateToPage()
        .mozVerifyElementsByGroup("jumpBackIn")
    on.settingsHomepage.navigateToPage()
        .mozClick(JUMP_BACK_IN_BUTTON)
    on.home.navigateToPage()
        .mozVerifyElementAbsent(JUMP_BACK_IN_SECTION)
}
```

**Fix:** `...tests.SettingsHomepageTest#jumpBackInOptionTest`.

**The lesson:** the author reached for a plausible-sounding method name instead of the one they had
just written. When the legacy and TAE tests share a name — which is the common case — the pointer is
usually just the legacy name with the package swapped. Copying a *different* name is the smell.

## Example 3 — resolves cleanly, still wrong

This is the one an existence check waves through. `ui/MainMenuTest.kt` contains two adjacent
conversions:

```kotlin
@Converted(
    replacedBy = ["org.mozilla.fenix.ui.efficiency.tests.MainMenuTest#verifyTheAddToHomeScreenSubMenuOptionTest"],
    ...
)
fun verifyTheAddToShortcutsSubMenuOptionTest() { ... }   // <-- Shortcuts

@Converted(
    replacedBy = ["org.mozilla.fenix.ui.efficiency.tests.MainMenuTest#verifyTheAddToHomeScreenSubMenuOptionTest"],
    ...
)
fun verifyTheAddToHomeScreenSubMenuOptionTest() { ... }  // <-- Home screen
```

Both point at the same TAE test. The pointer resolves, the class is right, the method is real and
live — and the first one is a copy-paste of the second. Meanwhile TAE's
`MainMenuTest#verifyTheAddToShortcutsSubMenuOptionTest` exists and is claimed by nothing.

The consequence: the legacy Shortcuts test looks converted and becomes a deletion candidate, while
the TAE test that actually covers Shortcuts is not recorded as covering anything. Delete the legacy
test on that basis and the bookkeeping says the coverage moved when the record of it never did.

**Fix:** point it at `...tests.MainMenuTest#verifyTheAddToShortcutsSubMenuOptionTest`.

**The detection rule:** *no two legacy tests may claim the same TAE test.* One TAE test genuinely
covering two legacy tests is possible, but it is rare enough that it should be stated in `notes`, not
left implicit — otherwise it is indistinguishable from this copy-paste.

---

## How to check before you land

Run the extractor behind the TAE dashboard; it resolves every pointer in the tree and reports on
anything that does not hold up:

```
python3 mobile/android/fenix/app/src/androidTest/java/org/mozilla/fenix/ui/efficiency/devtools/taedash/taedash.py
```

Exit output ends with a warning line if any pointer fails to resolve, is `@Ignore`d, or is claimed
twice. The dashboard's **Annotation integrity** panel lists each one with the actual class the method
lives in.

By hand, for the one annotation you are about to write:

```sh
cd mobile/android/fenix/app/src/androidTest/java/org/mozilla/fenix/ui

# 1. Does the target exist, in the class you named?
rg -n 'fun <methodName>' efficiency/tests/<ClassName>.kt

# 2. Is it live, not @Ignore'd? (check the annotations above the fun)
rg -n -B4 'fun <methodName>' efficiency/tests/<ClassName>.kt

# 3. Is anyone else already claiming it?
rg -n '<ClassName>#<methodName>' --glob '*.kt' -g '!efficiency/**' .
```

If step 3 returns a hit other than the annotation you are writing, stop — one of the two is wrong.

## Weaker signals worth a glance

Not defects, but they correlate with annotations written in a hurry:

- **22 of 87** conversions carry no `bug`. It is optional, but its absence means there is no
  Bugzilla trail if the pointer later turns out wrong. Example 1 — one of the two broken pointers —
  is among them.
- **27 of 111** live TAE tests have no `@Converted` pointing at them. Most are legitimately new
  coverage rather than replacements, but the set is where an orphaned replacement hides — as
  `verifyTheAddToShortcutsSubMenuOptionTest` in Example 3 does.
- `since` is populated on all 87. Keep it that way; it is the only thing making conversion pace
  measurable.

## Rules of thumb

1. **Copy the pointer from the file you just wrote**, not from memory and not from the annotation
   above it. Both broken pointers in the tree are recall errors, not typos.
2. **Same name on both sides is the norm.** If your pointer's method name differs from the legacy
   test's, you should be able to say why in one sentence. If you can't, it's wrong.
3. **Grep the target before you commit.** One `rg` against `efficiency/tests/` catches every mode in
   the table except the double claim, and a second grep across legacy `ui/` catches that one.
4. **Resolving is not correct.** The check that matters is whether the TAE test you named actually
   covers what the legacy test covered — read both bodies once.
5. **Partial coverage goes in `notes`,** with the bug tracking the gap. Three conversions do this
   today; that is the pattern to copy when the replacement is not a full parity swap.

---

_The two non-resolving pointers and the one double claim described here are live in the tree as of
this writing. They are listed on the dashboard's Annotation integrity panel, which regenerates from
source._
