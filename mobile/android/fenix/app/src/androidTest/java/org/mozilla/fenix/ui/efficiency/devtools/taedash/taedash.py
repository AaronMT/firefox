#!/usr/bin/env python3
"""Extract TAE (Test Automation Efficiency) metrics into data.js for the dashboard.

Reads the ui/efficiency tree and the legacy ui/ suite it is replacing, and emits
a single `window.TAE_DATA = {...}` payload so the dashboard runs from file://
without a server.

Usage:
    python3 taedash.py [--ui-root <path to ui/>] [--out <path to data.js>]
"""

import argparse
import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

# ---------------------------------------------------------------- kotlin parsing

TEST_FN_RE = re.compile(r"^\s*fun\s+([A-Za-z0-9_]+)\s*\(", re.M)
ANNOTATION_RE = re.compile(r"^\s*@([A-Za-z][A-Za-z0-9_]*)", re.M)


def method_body_lines(src, brace_open_idx):
    """Count non-blank, non-comment lines in the block starting at brace_open_idx."""
    depth = 0
    i = brace_open_idx
    while i < len(src):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    body = src[brace_open_idx + 1 : i]
    lines = [ln.strip() for ln in body.splitlines()]
    return len([
        ln for ln in lines if ln and not ln.startswith("//") and not ln.startswith("*")
    ])


def parse_converted_block(text):
    """Parse the argument list of a @Converted(...) annotation."""
    replaced = (
        re.findall(r'"([^"]+)"', text.split("replacedBy")[1].split("]")[0])
        if "replacedBy" in text
        else []
    )
    bug = re.search(r"bug\s*=\s*(\d+)", text)
    since = re.search(r'since\s*=\s*"([^"]*)"', text)
    notes = re.search(r'notes\s*=\s*"((?:[^"\\]|\\.)*)"', text)
    return {
        "replacedBy": replaced,
        "bug": int(bug.group(1)) if bug else 0,
        "since": since.group(1) if since else "",
        "notes": notes.group(1) if notes else "",
    }


def balanced_slice(src, start):
    """Return the text of a (...) group beginning at the '(' at/after start."""
    i = src.index("(", start)
    depth = 0
    j = i
    while j < len(src):
        if src[j] == "(":
            depth += 1
        elif src[j] == ")":
            depth -= 1
            if depth == 0:
                return src[i : j + 1], j
        j += 1
    return src[i:], len(src)


def parse_test_file(path):
    """Return per-test-method records for a Kotlin test file."""
    src = open(path, encoding="utf-8", errors="replace").read()
    cls = re.search(r"^(?:open\s+)?class\s+([A-Za-z0-9_]+)", src, re.M)
    class_name = cls.group(1) if cls else os.path.basename(path)[:-3]

    methods = []
    for m in TEST_FN_RE.finditer(src):
        name = m.group(1)
        # Walk backwards over the contiguous annotation/comment block above the fun.
        head_start = src.rfind("\n\n", 0, m.start())
        head = src[head_start if head_start >= 0 else 0 : m.start()]
        annotations = ANNOTATION_RE.findall(head)
        if "Test" not in annotations:
            continue

        conv = None
        if "@Converted" in head:
            block, _ = balanced_slice(head, head.index("@Converted"))
            conv = parse_converted_block(block)

        brace = src.find("{", m.end())
        methods.append({
            "name": name,
            "class": class_name,
            "file": os.path.basename(path),
            "loc": method_body_lines(src, brace) if brace >= 0 else 0,
            "smoke": "SmokeTest" in annotations,
            "ignored": "Ignore" in annotations,
            "converted": conv,
        })
    return methods


# A selector is declared either as a constant (`val NAME = Selector(`) or as a
# parameterized factory (`fun name(arg: String = "") = Selector(`).
SELECTOR_DECL_RE = re.compile(
    r"(?:val\s+([A-Za-z][A-Za-z0-9_]*)\s*=\s*Selector\()"
    r"|(?:fun\s+([A-Za-z][A-Za-z0-9_]*)\s*\([^)]*\)\s*(?::\s*Selector\s*)?=\s*Selector\()"
)


def parse_selectors(sel_dir):
    """Return every Selector(...) declaration in the catalog."""
    out = []
    for fname in sorted(os.listdir(sel_dir)):
        if not fname.endswith(".kt"):
            continue
        src = open(
            os.path.join(sel_dir, fname), encoding="utf-8", errors="replace"
        ).read()
        for m in SELECTOR_DECL_RE.finditer(src):
            block, _ = balanced_slice(src, m.end() - 1)
            strat = re.search(r"SelectorStrategy\.([A-Z_0-9]+)", block)
            groups = re.search(r"groups\s*=\s*listOf\(([^)]*)\)", block)
            out.append({
                "name": m.group(1) or m.group(2),
                "catalog": fname[:-3],
                "parameterized": m.group(2) is not None,
                "strategy": strat.group(1) if strat else "UNKNOWN",
                "groups": re.findall(r'"([^"]+)"', groups.group(1)) if groups else [],
            })
    return out


def parse_nav_edges(po_dir):
    """Return the navigation graph edges registered by page objects."""
    edges = []
    pages = []
    for fname in sorted(os.listdir(po_dir)):
        if not fname.endswith(".kt"):
            continue
        src = open(
            os.path.join(po_dir, fname), encoding="utf-8", errors="replace"
        ).read()
        page = re.search(r'override\s+val\s+pageName\s*=\s*"([^"]+)"', src)
        page_name = page.group(1) if page else fname[:-3]
        # The catalog a page owns is whichever one it filters in
        # mozGetSelectorsByGroup -- authoritative, unlike guessing from the name
        # (BrowserPage owns BrowserPageSelectors, not BrowserSelectors).
        owned = re.search(
            r"mozGetSelectorsByGroup[^}]*?([A-Za-z][A-Za-z0-9_]*Selectors)\s*\.\s*all",
            src,
            re.S,
        )
        pages.append({
            "name": page_name,
            "file": fname,
            "lines": len(src.splitlines()),
            "catalog": owned.group(1) if owned else "",
        })

        for m in re.finditer(r"NavigationRegistry\.register\(", src):
            block, _ = balanced_slice(src, m.end() - 1)
            frm = re.search(r"from\s*=\s*(?:\"([^\"]+)\"|pageName)", block)
            to = re.search(r"to\s*=\s*(?:\"([^\"]+)\"|pageName)", block)
            src_name = (
                (frm.group(1) if frm and frm.group(1) else page_name) if frm else None
            )
            dst_name = (
                (to.group(1) if to and to.group(1) else page_name) if to else page_name
            )
            if not src_name:
                continue
            steps = len(re.findall(r"NavigationStep\.", block))
            edges.append({
                "from": src_name,
                "to": dst_name,
                "steps": steps,
                "launchOnly": "LaunchConfig" in block or steps == 0,
            })
    return pages, edges


# The public verb library tests compose against. Categories are matched in order,
# so the more specific patterns must come first.
PRIMITIVE_CATEGORIES = [
    ("Lifecycle", (r"^setUp$", r"^tearDown", r"^launchConfig$")),
    (
        "Navigation",
        (r"^navigateToPage$", r"^mozOpenNotificationsTray$", r"^mozPressBack"),
    ),
    ("Assertion", (r"^mozVerify", r"^mozWaitUntil")),
    ("Input", (r"^mozEnterText$", r"^mozClear", r"^mozPressEnter$")),
    ("Gesture", (r"^mozSwipe", r"^mozLongClick$", r"^mozClick")),
    ("State query", (r"^mozIs", r"^dismiss")),
]

# Exactly four spaces of indent = a direct class member. Deeper means a local
# function nested inside another (e.g. `candidates` inside resolveComposeNode),
# which is not part of the public verb surface.
PUBLIC_FUN_RE = re.compile(
    r"^ {4}(?!.*\bprivate\b)(?:open |internal |protected )*fun +([A-Za-z][A-Za-z0-9_]*) *\(",
    re.M,
)


def parse_primitives(helpers_dir):
    """Return the public verbs BasePage/BaseTest expose, bucketed by what they do."""
    out = []
    for fname in ("BasePage.kt", "BaseTest.kt"):
        path = os.path.join(helpers_dir, fname)
        if not os.path.exists(path):
            continue
        src = open(path, encoding="utf-8", errors="replace").read()
        seen = set()
        for m in PUBLIC_FUN_RE.finditer(src):
            name = m.group(1)
            if name in seen:
                continue
            seen.add(name)
            category = "Other"
            for label, patterns in PRIMITIVE_CATEGORIES:
                if any(re.search(p, name) for p in patterns):
                    category = label
                    break
            # Signature up to the closing paren, for the tooltip.
            sig, _ = balanced_slice(src, m.end() - 1)
            out.append({
                "name": name,
                "source": fname[:-3],
                "category": category,
                "args": sig.count(",") + 1 if sig.strip("()").strip() else 0,
            })
    return out


def parse_page_accessors(page_context_path):
    """Map the `on.<accessor>` name tests use to the page class it constructs."""
    if not os.path.exists(page_context_path):
        return {}
    src = open(page_context_path, encoding="utf-8", errors="replace").read()
    pattern = re.compile(r"val\s+([a-z][A-Za-z0-9_]*)\s*=\s*([A-Z][A-Za-z0-9_]*)\s*\(")
    return {m.group(1): m.group(2) for m in pattern.finditer(src)}


# Direct references to the UI toolkits. A test body containing these is coupled
# to Espresso/UIAutomator/Compose; the whole point of the harness is that only
# the shared layer touches them. Surfaced on the dashboard so the count is
# auditable rather than a number to take on faith.
TOOLKIT_API_RE = re.compile(
    r"\bonView\(|\bwithId\(|\bwithText\(|\bmDevice\.|\bUiSelector\(|\bUiScrollable\(|"
    r"\bcomposeTestRule\.onNode|\bonNodeWithTag\(|\bonNodeWithText\(|\bonNodeWithContentDescription\(|"
    r"\bEspresso\.|\bmatch\(|\bcheck\(matches\("
)


def count_toolkit_calls(paths):
    """Count direct UI-toolkit call sites across the given Kotlin files."""
    total, files_touched = 0, 0
    for p in paths:
        src = open(p, encoding="utf-8", errors="replace").read()
        n = len(TOOLKIT_API_RE.findall(src))
        total += n
        if n:
            files_touched += 1
    return total, files_touched


def kt_files(d):
    if not os.path.isdir(d):
        return []
    return [
        os.path.join(dp, n) for dp, _, ns in os.walk(d) for n in ns if n.endswith(".kt")
    ]


def dir_stats(root, sub):
    path = os.path.join(root, sub)
    files, lines = 0, 0
    for dirpath, _, names in os.walk(path):
        for n in names:
            if n.endswith(".kt"):
                files += 1
                with open(
                    os.path.join(dirpath, n), encoding="utf-8", errors="replace"
                ) as fh:
                    lines += sum(1 for _ in fh)
    return {"layer": sub, "files": files, "lines": lines}


def git_meta(repo_root, eff_rel):
    def run(*args):
        try:
            return subprocess.run(
                ["git", "-C", repo_root, *args],
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            ).stdout.strip()
        except Exception:
            return ""

    log = run("log", "--format=%ad|%an|%s", "--date=short", "--", eff_rel)
    commits = []
    for line in log.splitlines():
        parts = line.split("|", 2)
        if len(parts) == 3:
            commits.append({"date": parts[0], "author": parts[1], "subject": parts[2]})
    shallow = os.path.exists(os.path.join(repo_root, ".git", "shallow"))
    return {"commits": commits, "shallow": shallow}


# ---------------------------------------------------------------- aggregation


def build(ui_root, repo_root):
    eff_root = os.path.join(ui_root, "efficiency")

    # --- TAE tests
    tae_dir = os.path.join(eff_root, "tests")
    tae_tests = []
    for f in sorted(os.listdir(tae_dir)):
        if f.endswith(".kt"):
            tae_tests.extend(parse_test_file(os.path.join(tae_dir, f)))

    # --- legacy tests (everything in ui/ that is not the efficiency tree)
    legacy_tests = []
    for f in sorted(os.listdir(ui_root)):
        full = os.path.join(ui_root, f)
        if os.path.isfile(full) and f.endswith(".kt"):
            legacy_tests.extend(parse_test_file(full))

    # --- conversion records
    conversions = []
    tae_index = {f"{t['class']}#{t['name']}": t for t in tae_tests}
    by_method = defaultdict(list)
    for t in tae_tests:
        by_method[t["name"]].append(t)

    for t in legacy_tests:
        if not t["converted"]:
            continue
        c = t["converted"]
        targets = []
        for ptr in c["replacedBy"]:
            short = ptr.rsplit(".", 1)[-1]
            hit = tae_index.get(short)
            status, actual = "ok", ""
            if hit is None:
                # The method may exist under a different class than the pointer claims.
                elsewhere = by_method.get(short.split("#")[-1], [])
                if elsewhere:
                    status, actual = "wrong-class", elsewhere[0]["class"]
                else:
                    status = "missing"
            elif hit["ignored"]:
                status = "ignored"
            targets.append({"pointer": ptr, "status": status, "actualClass": actual})
        conversions.append({
            "legacy": f"{t['class']}#{t['name']}",
            "legacyClass": t["class"],
            "legacyLoc": t["loc"],
            "smoke": t["smoke"],
            "bug": c["bug"],
            "since": c["since"],
            "notes": c["notes"],
            "targets": targets,
        })

    # The conversion effort targets the legacy @SmokeTest suite, so every
    # progress figure below is scoped to it. An @Ignore'd legacy smoke test is
    # disabled and not a conversion target while it stays that way, so it is
    # held out of the denominator and reported separately.
    smoke_conversions = [c for c in conversions if c["smoke"]]

    # --- cumulative conversion timeline (smoke only)
    by_month = Counter(c["since"] for c in smoke_conversions if c["since"])
    months = sorted(by_month)
    timeline, running = [], 0
    for mth in months:
        running += by_month[mth]
        timeline.append({"month": mth, "added": by_month[mth], "cumulative": running})

    # --- per-area conversion status
    legacy_by_class = defaultdict(
        lambda: {
            "total": 0,
            "converted": 0,
            "smoke": 0,
            "smokeConverted": 0,
            "smokeIgnored": 0,
        }
    )
    for t in legacy_tests:
        rec = legacy_by_class[t["class"]]
        rec["total"] += 1
        if t["converted"]:
            rec["converted"] += 1
        if t["smoke"]:
            rec["smoke"] += 1
            if t["ignored"]:
                rec["smokeIgnored"] += 1
            if t["converted"]:
                rec["smokeConverted"] += 1
    for rec in legacy_by_class.values():
        rec["smokeActive"] = rec["smoke"] - rec["smokeIgnored"]
    areas = [
        {"area": k, **v}
        for k, v in sorted(
            legacy_by_class.items(),
            key=lambda kv: (-kv[1]["smokeConverted"], -kv[1]["smokeActive"]),
        )
        if v["smokeActive"] > 0 or v["smokeConverted"] > 0
    ]

    # --- selectors + navigation
    selectors = parse_selectors(os.path.join(eff_root, "selectors"))
    pages, edges = parse_nav_edges(os.path.join(eff_root, "pageObjects"))
    primitives = parse_primitives(os.path.join(eff_root, "helpers"))
    accessors = parse_page_accessors(
        os.path.join(eff_root, "helpers", "PageContext.kt")
    )

    # --- per-screen density: how thoroughly each modelled screen is described
    sel_by_catalog = Counter()
    groups_by_catalog = defaultdict(set)
    for s in selectors:
        sel_by_catalog[s["catalog"]] += 1
        groups_by_catalog[s["catalog"]].update(s["groups"])

    in_deg, out_deg = Counter(), Counter()
    for e in edges:
        out_deg[e["from"]] += 1
        in_deg[e["to"]] += 1

    # How often tests reach for each screen, via its `on.<accessor>` handle.
    usage = Counter()
    tests_src = ""
    for f in sorted(os.listdir(tae_dir)):
        if f.endswith(".kt"):
            tests_src += open(
                os.path.join(tae_dir, f), encoding="utf-8", errors="replace"
            ).read()
    for accessor, cls in accessors.items():
        usage[cls] = len(re.findall(rf"\bon\.{re.escape(accessor)}\b", tests_src))

    heatmap = []
    for p in pages:
        cat = p["catalog"]
        heatmap.append({
            "page": p["name"],
            "catalog": cat,
            "selectors": sel_by_catalog.get(cat, 0),
            "groups": len(groups_by_catalog.get(cat, ())),
            "inbound": in_deg.get(p["name"], 0),
            "outbound": out_deg.get(p["name"], 0),
            "usage": usage.get(p["name"], 0),
            "lines": p["lines"],
        })
    heatmap.sort(
        key=lambda r: (r["usage"], r["selectors"], r["inbound"] + r["outbound"]),
        reverse=True,
    )

    strategy_family = {}
    for s in selectors:
        st = s["strategy"]
        fam = (
            "Compose"
            if st.startswith("COMPOSE")
            else "Espresso"
            if st.startswith("ESPRESSO")
            else "UIAutomator"
        )
        strategy_family[st] = fam

    # --- framework composition
    layers = [
        dir_stats(eff_root, d)
        for d in (
            "core",
            "helpers",
            "navigation",
            "generation",
            "devtools",
            "logging",
            "pageObjects",
            "selectors",
            "tests",
            "data",
        )
    ]
    shared = sum(l["lines"] for l in layers if l["layer"] != "tests")
    test_lines = sum(l["lines"] for l in layers if l["layer"] == "tests")

    # --- the legacy robot layer, the thing the page-object model replaces
    robot_files = kt_files(os.path.join(ui_root, "robots"))
    robot_lines = sum(
        sum(1 for _ in open(p, encoding="utf-8", errors="replace")) for p in robot_files
    )
    po_sel_lines = sum(
        l["lines"] for l in layers if l["layer"] in ("pageObjects", "selectors")
    )

    legacy_files = [
        os.path.join(ui_root, f)
        for f in sorted(os.listdir(ui_root))
        if f.endswith(".kt") and os.path.isfile(os.path.join(ui_root, f))
    ]
    tae_files = kt_files(tae_dir)
    legacy_leak, legacy_leak_files = count_toolkit_calls(legacy_files)
    tae_leak, tae_leak_files = count_toolkit_calls(tae_files)
    robot_leak, _ = count_toolkit_calls(robot_files)
    shared_leak, _ = count_toolkit_calls(
        kt_files(os.path.join(eff_root, "helpers"))
        + kt_files(os.path.join(eff_root, "core"))
    )

    live_tae = [t for t in tae_tests if not t["ignored"]]
    legacy_smoke = [t for t in legacy_tests if t["smoke"]]
    legacy_smoke_ignored = [t for t in legacy_smoke if t["ignored"]]
    conv_legacy_loc = [c["legacyLoc"] for c in smoke_conversions if c["legacyLoc"]]
    # LOC of the TAE tests that actually replace a converted legacy smoke test
    replacement_names = {
        tgt["pointer"].rsplit(".", 1)[-1]
        for c in smoke_conversions
        for tgt in c["targets"]
    }
    replacement_loc = [
        tae_index[n]["loc"]
        for n in replacement_names
        if n in tae_index and tae_index[n]["loc"]
    ]
    bad_pointers = [
        {"legacy": c["legacy"], **t}
        for c in conversions
        for t in c["targets"]
        if t["status"] != "ok"
    ]

    # A pointer can resolve cleanly and still be wrong: if two legacy tests name
    # the same TAE test, one of them is almost always a copy-paste, and the TAE
    # test that should have been named goes unclaimed.
    claims = defaultdict(list)
    for c in conversions:
        for t in c["targets"]:
            claims[t["pointer"]].append(c["legacy"])
    for pointer, claimants in sorted(claims.items()):
        if len(claimants) > 1:
            bad_pointers.append({
                "legacy": " + ".join(claimants),
                "pointer": pointer,
                "status": "double-claim",
                "actualClass": "",
                "claimants": claimants,
            })

    def avg(xs):
        return round(sum(xs) / len(xs), 1) if xs else 0

    return {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "git": git_meta(repo_root, os.path.relpath(eff_root, repo_root)),
        "summary": {
            "taeTests": len(tae_tests),
            "taeLive": len(live_tae),
            "taeIgnored": len(tae_tests) - len(live_tae),
            "taeSmoke": len([t for t in live_tae if t["smoke"]]),
            "taeClasses": len({t["class"] for t in tae_tests}),
            # --- the conversion scope: the legacy @SmokeTest suite
            "smokeTotal": len(legacy_smoke),
            "smokeIgnored": len(legacy_smoke_ignored),
            "smokeActive": len(legacy_smoke) - len(legacy_smoke_ignored),
            "smokeConverted": len(smoke_conversions),
            "smokeRemaining": len(legacy_smoke)
            - len(legacy_smoke_ignored)
            - len(smoke_conversions),
            "smokeClasses": len({t["class"] for t in legacy_smoke}),
            # --- whole legacy suite, for context only
            "legacyTests": len(legacy_tests),
            "legacyClasses": len({t["class"] for t in legacy_tests}),
            "converted": len(conversions),
            "nonSmokeConverted": len(conversions) - len(smoke_conversions),
            "pages": len(pages),
            "selectors": len(selectors),
            "catalogs": len({s["catalog"] for s in selectors}),
            "edges": len(edges),
            "bugs": len({c["bug"] for c in conversions if c["bug"]}),
            "sharedLines": shared,
            "testLines": test_lines,
            "avgTaeLoc": avg([t["loc"] for t in live_tae]),
            "avgLegacyLoc": avg([t["loc"] for t in legacy_tests]),
            "avgConvertedLegacyLoc": avg(conv_legacy_loc),
            "avgReplacementLoc": avg(replacement_loc),
            "parameterizedSelectors": len([s for s in selectors if s["parameterized"]]),
            "primitives": len(primitives),
            "verbs": len([p for p in primitives if p["category"] != "Lifecycle"]),
            # --- complexity against the robot pattern
            "robotFiles": len(robot_files),
            "robotLines": robot_lines,
            "robotLinesPerScreen": round(robot_lines / len(robot_files), 1)
            if robot_files
            else 0,
            "pageModelLines": po_sel_lines,
            "pageModelLinesPerScreen": round(po_sel_lines / len(pages), 1)
            if pages
            else 0,
            "legacyToolkitCalls": legacy_leak,
            "legacyToolkitFiles": legacy_leak_files,
            "taeToolkitCalls": tae_leak,
            "taeToolkitFiles": tae_leak_files,
            "legacyTestFiles": len(legacy_files),
            "taeTestFiles": len(tae_files),
            "robotToolkitCalls": robot_leak,
            "sharedToolkitCalls": shared_leak,
            "selectorGroupsTotal": len({g for s in selectors for g in s["groups"]}),
            "pagesWithNoSelectors": len([h for h in heatmap if h["selectors"] == 0]),
            "pagesUnusedByTests": len([h for h in heatmap if h["usage"] == 0]),
            "unresolvedPointers": len(bad_pointers),
            "totalPointers": len([t for c in conversions for t in c["targets"]]),
        },
        "badPointers": bad_pointers,
        "primitives": sorted(primitives, key=lambda p: (p["category"], p["name"])),
        "primitiveCategories": [
            {"category": k, "count": v}
            for k, v in sorted(
                Counter(p["category"] for p in primitives).items(),
                key=lambda kv: -kv[1],
            )
        ],
        "heatmap": heatmap,
        "timeline": timeline,
        "conversions": sorted(
            conversions, key=lambda c: (c["since"], c["legacy"]), reverse=True
        ),
        "areas": areas,
        "taeTests": sorted(tae_tests, key=lambda t: (t["class"], t["name"])),
        "pages": sorted(pages, key=lambda p: p["name"]),
        "edges": edges,
        "selectorStrategies": [
            {"strategy": k, "family": strategy_family[k], "count": v}
            for k, v in sorted(
                Counter(s["strategy"] for s in selectors).items(), key=lambda kv: -kv[1]
            )
        ],
        "selectorGroups": [
            {"group": k, "count": v}
            for k, v in sorted(
                Counter(g for s in selectors for g in s["groups"]).items(),
                key=lambda kv: -kv[1],
            )[:14]
        ],
        "catalogs": [
            {"catalog": k, "count": v}
            for k, v in sorted(
                Counter(s["catalog"] for s in selectors).items(), key=lambda kv: -kv[1]
            )
        ],
        "layers": sorted(layers, key=lambda l: -l["lines"]),
    }


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    default_ui = os.path.abspath(os.path.join(here, "..", "..", ".."))
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--ui-root", default=default_ui, help="path to org/mozilla/fenix/ui"
    )
    ap.add_argument("--out", default=os.path.join(here, "data.js"))
    args = ap.parse_args()

    if not os.path.isdir(os.path.join(args.ui_root, "efficiency")):
        sys.exit(f"error: no efficiency/ under {args.ui_root}")

    repo_root = (
        subprocess.run(
            ["git", "-C", args.ui_root, "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=False,
        ).stdout.strip()
        or args.ui_root
    )

    data = build(args.ui_root, repo_root)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write("// Generated by taedash.py -- do not edit by hand.\n")
        fh.write("window.TAE_DATA = ")
        json.dump(data, fh, indent=1, sort_keys=False)
        fh.write(";\n")

    s = data["summary"]
    print(f"wrote {args.out}")
    print(
        f"  {s['taeTests']} TAE tests ({s['taeLive']} live) across {s['taeClasses']} classes"
    )
    print(f"  {s['converted']}/{s['legacyTests']} legacy tests marked converted")
    print(f"  {s['pages']} pages, {s['edges']} nav edges, {s['selectors']} selectors")
    if s["unresolvedPointers"]:
        print(
            f"  WARNING: {s['unresolvedPointers']} unresolved/ignored replacedBy pointers"
        )


if __name__ == "__main__":
    main()
