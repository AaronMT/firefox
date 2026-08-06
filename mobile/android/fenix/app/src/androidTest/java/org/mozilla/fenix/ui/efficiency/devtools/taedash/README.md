# taedash — the TAE dashboard

A static dashboard (plain HTML/CSS/JS, no build step, no dependencies) summarising the Test
Automation Efficiency effort: conversion progress out of the legacy suite, the coverage surface the
harness can reach, and the health of the `@Converted` bookkeeping.

## Use it

```
python3 taedash.py     # re-parses the tree, rewrites data.js
open index.html        # or just double-click it
```

`index.html` opens straight from `file://` — the extractor writes `data.js` as a
`window.TAE_DATA = {...}` assignment rather than JSON precisely so no server is needed.

## What it shows

| Panel                | Reads from                                                                 |
| -------------------- | -------------------------------------------------------------------------- |
| Headline & KPIs      | `@Test`/`@SmokeTest`/`@Ignore` counts in `ui/efficiency/tests` and legacy `ui/` |
| Conversion progress  | the `since = "YYYY-MM"` stamp on each legacy `@Converted`                    |
| By legacy suite      | converted vs. total `@Test` per legacy test class                            |
| Test economy         | measured test-body lengths, plus Kotlin line counts per `ui/efficiency` layer |
| Coverage surface     | `Selector(...)` declarations in `selectors/`, `NavigationRegistry.register` edges in `pageObjects/` |
| Annotation integrity | whether every `replacedBy` pointer resolves to a real, non-`@Ignore`d `@Test` |
| Conversion ledger    | every `@Converted` record; doubles as the table view for the charts          |

Every figure is parsed from the tree at generation time — nothing is hand-entered, so a stale
number means `taedash.py` needs re-running, not that someone forgot to edit a constant.

## Files

```
taedash.py    the extractor — Kotlin source in, data.js out
data.js       generated; do not edit by hand
index.html    page structure
styles.css    light/dark theming (follows the OS, with an in-page toggle)
dashboard.js  chart rendering (inline SVG) + table filtering
```

## Notes

- `taedash.py` parses Kotlin with regexes, not a real parser. It is accurate for the shapes the
  harness actually uses (annotation blocks above `fun`, `val NAME = Selector(...)`, parameterised
  `fun name(...) = Selector(...)`, `NavigationRegistry.register(...)`). New syntax may need it taught.
- The integrity panel is the closest thing we currently have to the conversion lint check described
  in `customannotations/Converted.kt`; that lint does not exist in-tree yet, so nothing else
  catches a `replacedBy` pointer that drifts.
