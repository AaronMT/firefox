/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

(function () {
  "use strict";

  const D = window.TAE_DATA;
  if (!D) {
    document.body.innerHTML =
      "<p style='padding:40px'>data.js missing — run <code>python3 taedash.py</code>.</p>";
    return;
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  /** Pointer-resolution states, as the finding cards and the ledger label them. */
  const POINTER_LABELS = {
    ok: { finding: "Resolves", ledger: "Resolves" },
    "wrong-class": { finding: "Wrong class", ledger: "Wrong class" },
    missing: { finding: "No such test", ledger: "Missing" },
    ignored: { finding: "Points at @Ignore", ledger: "Ignored" },
    "double-claim": { finding: "Claimed twice", ledger: "Claimed twice" },
  };

  // ------------------------------------------------------------------ utils

  function token(name) {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
  }

  function el(tag, attrs, text) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k in attrs || {}) {
      if (attrs[k] !== null && attrs[k] !== undefined) {
        n.setAttribute(k, attrs[k]);
      }
    }
    if (text !== undefined) {
      n.textContent = text;
    }
    return n;
  }

  function html(tag, className, text) {
    const n = document.createElement(tag);
    if (className) {
      n.className = className;
    }
    if (text !== undefined) {
      n.textContent = text;
    }
    return n;
  }

  const measureCtx = document.createElement("canvas").getContext("2d");
  function textWidth(str, size, weight) {
    measureCtx.font = `${weight || 400} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    return measureCtx.measureText(String(str)).width;
  }

  function fmtMonth(iso) {
    const [y, m] = iso.split("-");
    return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
  }

  function fmtInt(n) {
    return Number(n).toLocaleString("en-US");
  }

  function niceTicks(max, count) {
    if (max <= 0) {
      return [0];
    }
    const raw = max / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step =
      [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw) || 10 * mag;
    const ticks = [];
    for (let v = 0; v <= max + step * 0.001; v += step) {
      ticks.push(Math.round(v * 1000) / 1000);
    }
    return ticks;
  }

  /** Bar path with a rounded data-end and a square baseline end. */
  function barPath(x, y, w, h, r, dir) {
    const rr = Math.max(
      0,
      Math.min(r, dir === "right" ? w : h, dir === "right" ? h / 2 : w / 2)
    );
    if (rr <= 0.5) {
      return `M${x},${y}h${w}v${h}h${-w}Z`;
    }
    if (dir === "right") {
      return `M${x},${y}H${x + w - rr}A${rr},${rr} 0 0 1 ${x + w},${y + rr}V${y + h - rr}A${rr},${rr} 0 0 1 ${
        x + w - rr
      },${y + h}H${x}Z`;
    }
    // grows up from the baseline
    return `M${x},${y + h}V${y + rr}A${rr},${rr} 0 0 1 ${x + rr},${y}H${x + w - rr}A${rr},${rr} 0 0 1 ${x + w},${
      y + rr
    }V${y + h}Z`;
  }

  // ---------------------------------------------------------------- tooltip

  const tipEl = document.getElementById("tooltip");

  function showTip(evt, title, rows) {
    tipEl.innerHTML = "";
    const t = html("div", "tooltip-title", title);
    tipEl.appendChild(t);
    (rows || []).forEach(r => {
      const row = html("div", "tooltip-row");
      if (r.color) {
        const key = html("span", "tooltip-key");
        const dot = html("span", "legend-swatch");
        dot.style.background = r.color;
        dot.style.borderRadius = "50%";
        dot.style.width = "9px";
        dot.style.height = "9px";
        key.appendChild(dot);
        key.appendChild(document.createTextNode(r.label));
        row.appendChild(key);
        row.appendChild(document.createTextNode(` ${r.value}`));
      } else {
        row.textContent = `${r.label} ${r.value}`;
      }
      tipEl.appendChild(row);
    });
    tipEl.dataset.show = "1";
    moveTip(evt);
  }

  function moveTip(evt) {
    const pad = 12;
    const rect = tipEl.getBoundingClientRect();
    let x = evt.clientX;
    let y = evt.clientY - pad;
    x = Math.min(
      Math.max(x, rect.width / 2 + 4),
      window.innerWidth - rect.width / 2 - 4
    );
    if (y - rect.height < 4) {
      y = evt.clientY + rect.height + pad;
    }
    tipEl.style.left = `${x}px`;
    tipEl.style.top = `${y}px`;
  }

  function hideTip() {
    tipEl.dataset.show = "0";
  }

  function attachTip(node, title, rows) {
    node.addEventListener("pointerenter", e => showTip(e, title, rows));
    node.addEventListener("pointermove", moveTip);
    node.addEventListener("pointerleave", hideTip);
  }

  // ------------------------------------------------------------- chart base

  /** Re-renders `draw(container, width)` whenever the container's width changes. */
  const charts = [];
  function mount(id, draw) {
    const node = document.getElementById(id);
    if (!node) {
      return;
    }
    const entry = { node, draw };
    charts.push(entry);
    renderChart(entry);
    if (window.ResizeObserver) {
      let last = node.clientWidth;
      new ResizeObserver(() => {
        if (Math.abs(node.clientWidth - last) > 1) {
          last = node.clientWidth;
          renderChart(entry);
        }
      }).observe(node);
    }
  }

  function renderChart(entry) {
    const w = entry.node.clientWidth || 560;
    entry.node.innerHTML = "";
    hideTip();
    entry.draw(entry.node, w);
  }

  function redrawAll() {
    charts.forEach(renderChart);
  }

  // ------------------------------------------------- horizontal bar chart

  /**
   * rows: [{ label, segments: [{value, color, name}], tipRows, endLabel }]
   * One shared value scale; 2px surface gap between touching segments.
   */
  function hBars(container, width, rows, opts) {
    const o = Object.assign(
      { barH: 18, gap: 12, labelSize: 13, valueSize: 12.5, minLabelW: 90 },
      opts || {}
    );
    const surface = token("--surface-1");
    const ink = token("--text-primary");
    const muted = token("--text-muted");

    const labelW = Math.min(
      Math.max(
        o.minLabelW,
        ...rows.map(r => textWidth(r.label, o.labelSize, 400) + 12)
      ),
      Math.max(o.minLabelW, width * 0.42)
    );
    const endW =
      Math.max(
        ...rows.map(r => textWidth(r.endLabel || "", o.valueSize, 600))
      ) + 10;
    const plotW = Math.max(40, width - labelW - endW);
    const max = Math.max(
      1,
      ...rows.map(r => r.segments.reduce((s, g) => s + g.value, 0))
    );
    const rowH = o.barH + o.gap;
    const height = rows.length * rowH - o.gap + 4;

    const svg = el("svg", {
      viewBox: `0 0 ${width} ${height}`,
      height,
      role: "img",
    });

    rows.forEach((row, i) => {
      const y = i * rowH;

      const lbl = el("text", {
        x: labelW - 12,
        y: y + o.barH / 2,
        "text-anchor": "end",
        "dominant-baseline": "central",
        "font-size": o.labelSize,
        fill: ink,
      });
      lbl.textContent = row.label;
      svg.appendChild(lbl);

      let cursor = labelW;
      const total = row.segments.reduce((s, g) => s + g.value, 0);
      row.segments.forEach((seg, si) => {
        if (seg.value <= 0) {
          return;
        }
        const isLast =
          si === row.segments.length - 1 ||
          row.segments.slice(si + 1).every(s => s.value <= 0);
        const raw = (seg.value / max) * plotW;
        // 2px surface gap between touching segments
        const w = Math.max(1, isLast ? raw : raw - 2);
        const path = el("path", {
          d: barPath(cursor, y, w, o.barH, 4, "right"),
          fill: seg.color,
        });
        attachTip(
          path,
          row.label,
          row.tipRows || [
            { label: seg.name, value: fmtInt(seg.value), color: seg.color },
          ]
        );
        svg.appendChild(path);
        cursor += raw;
      });

      if (row.endLabel) {
        const t = el("text", {
          x: labelW + (total / max) * plotW + 8,
          y: y + o.barH / 2,
          "dominant-baseline": "central",
          "font-size": o.valueSize,
          "font-weight": 600,
          fill: row.endLabelMuted ? muted : ink,
        });
        t.textContent = row.endLabel;
        svg.appendChild(t);
      }
      void surface;
    });

    container.appendChild(svg);
  }

  // ------------------------------------------------------------- line chart

  function lineChart(container, width, points, opts) {
    const o = Object.assign(
      { height: 230, padL: 40, padR: 44, padT: 14, padB: 30 },
      opts || {}
    );
    const grid = token("--gridline");
    const axis = token("--baseline");
    const muted = token("--text-muted");
    const ink = token("--text-primary");
    const surface = token("--surface-1");
    const color = token("--series-1");

    const h = o.height;
    const plotW = Math.max(40, width - o.padL - o.padR);
    const plotH = h - o.padT - o.padB;
    const max = Math.max(...points.map(p => p.y));
    const ticks = niceTicks(max, 4);
    const yMax = ticks[ticks.length - 1];

    const X = i =>
      o.padL +
      (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
    const Y = v => o.padT + plotH - (v / yMax) * plotH;

    const svg = el("svg", {
      viewBox: `0 0 ${width} ${h}`,
      height: h,
      role: "img",
    });

    ticks.forEach(t => {
      svg.appendChild(
        el("line", {
          x1: o.padL,
          x2: o.padL + plotW,
          y1: Y(t),
          y2: Y(t),
          stroke: t === 0 ? axis : grid,
          "stroke-width": 1,
        })
      );
      const lab = el("text", {
        x: o.padL - 9,
        y: Y(t),
        "text-anchor": "end",
        "dominant-baseline": "central",
        "font-size": 11.5,
        fill: muted,
      });
      lab.textContent = fmtInt(t);
      svg.appendChild(lab);
    });

    const area = points
      .map((p, i) => `${i ? "L" : "M"}${X(i)},${Y(p.y)}`)
      .join("");
    svg.appendChild(
      el("path", {
        d: `${area}L${X(points.length - 1)},${Y(0)}L${X(0)},${Y(0)}Z`,
        fill: color,
        opacity: 0.1,
      })
    );
    svg.appendChild(
      el("path", {
        d: area,
        fill: "none",
        stroke: color,
        "stroke-width": 2,
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      })
    );

    points.forEach((p, i) => {
      const isLast = i === points.length - 1;
      svg.appendChild(
        el("circle", {
          cx: X(i),
          cy: Y(p.y),
          r: isLast ? 5 : 4,
          fill: color,
          stroke: surface,
          "stroke-width": 2,
        })
      );
      const lab = el("text", {
        x: X(i),
        y: h - o.padB + 16,
        "text-anchor": "middle",
        "font-size": 11.5,
        fill: muted,
      });
      lab.textContent = p.label;
      svg.appendChild(lab);

      // generous hit target
      const hit = el("rect", {
        x: X(i) - plotW / (points.length * 2) - 2,
        y: o.padT,
        width: plotW / points.length + 4,
        height: plotH,
        fill: "transparent",
      });
      attachTip(hit, p.tipTitle, p.tipRows);
      svg.appendChild(hit);
    });

    // direct label on the endpoint only
    const last = points[points.length - 1];
    const endLab = el("text", {
      x: X(points.length - 1) + 10,
      y: Y(last.y),
      "dominant-baseline": "central",
      "font-size": 13,
      "font-weight": 640,
      fill: ink,
    });
    endLab.textContent = fmtInt(last.y);
    svg.appendChild(endLab);

    container.appendChild(svg);
  }

  // ----------------------------------------------------------- column chart

  function columnChart(container, width, bars, opts) {
    const o = Object.assign(
      { height: 230, padT: 22, padB: 30, padL: 34, padR: 8 },
      opts || {}
    );
    const grid = token("--gridline");
    const axis = token("--baseline");
    const muted = token("--text-muted");
    const ink = token("--text-primary");
    const color = token("--series-1");

    const h = o.height;
    const plotW = Math.max(40, width - o.padL - o.padR);
    const plotH = h - o.padT - o.padB;
    const max = Math.max(...bars.map(b => b.value));
    const ticks = niceTicks(max, 3);
    const yMax = ticks[ticks.length - 1];
    const band = plotW / bars.length;
    const barW = Math.min(24, band * 0.55);

    const svg = el("svg", {
      viewBox: `0 0 ${width} ${h}`,
      height: h,
      role: "img",
    });

    ticks.forEach(t => {
      const y = o.padT + plotH - (t / yMax) * plotH;
      svg.appendChild(
        el("line", {
          x1: o.padL,
          x2: o.padL + plotW,
          y1: y,
          y2: y,
          stroke: t === 0 ? axis : grid,
          "stroke-width": 1,
        })
      );
      const lab = el("text", {
        x: o.padL - 9,
        y,
        "text-anchor": "end",
        "dominant-baseline": "central",
        "font-size": 11.5,
        fill: muted,
      });
      lab.textContent = fmtInt(t);
      svg.appendChild(lab);
    });

    bars.forEach((b, i) => {
      const cx = o.padL + band * i + band / 2;
      const bh = (b.value / yMax) * plotH;
      const y = o.padT + plotH - bh;
      const path = el("path", {
        d: barPath(cx - barW / 2, y, barW, bh, 4, "up"),
        fill: color,
      });
      attachTip(path, b.tipTitle, b.tipRows);
      svg.appendChild(path);

      const cap = el("text", {
        x: cx,
        y: y - 7,
        "text-anchor": "middle",
        "font-size": 12,
        "font-weight": 600,
        fill: ink,
      });
      cap.textContent = fmtInt(b.value);
      svg.appendChild(cap);

      const lab = el("text", {
        x: cx,
        y: h - o.padB + 16,
        "text-anchor": "middle",
        "font-size": 11.5,
        fill: muted,
      });
      lab.textContent = b.label;
      svg.appendChild(lab);
    });

    container.appendChild(svg);
  }

  // ------------------------------------------------------------------ views

  const S = D.summary;

  function renderHeadline() {
    document.getElementById("generated-at").textContent = D.generatedAt;
    document.getElementById("hero-converted").textContent = fmtInt(
      S.smokeConverted
    );
    document.getElementById("hero-note").textContent =
      `of ${fmtInt(S.smokeActive)} active legacy @SmokeTest methods across ${S.smokeClasses} classes. ` +
      `${fmtInt(S.smokeRemaining)} still to go.`;

    const pct = Math.round((S.smokeConverted / S.smokeActive) * 100);
    document.getElementById("smoke-meter-value").textContent = `${pct}%`;
    document.getElementById("smoke-meter-fill").style.width = `${pct}%`;
    document
      .getElementById("smoke-meter-role")
      .setAttribute(
        "aria-label",
        `${S.smokeConverted} of ${S.smokeActive} active legacy smoke tests converted, ${pct} percent`
      );
    document.getElementById("smoke-meter-note").textContent =
      `${fmtInt(S.smokeTotal)} legacy @SmokeTest methods exist; ${S.smokeIgnored} are @Ignore'd and ` +
      `held out of the denominator as they are disabled, not pending. ` +
      `${S.nonSmokeConverted} non-smoke conversions are excluded from every figure on this page.`;

    const kpis = [
      {
        v: fmtInt(S.taeLive),
        l: "Live TAE tests",
        n: `${S.taeSmoke} smoke · ${S.taeIgnored} ignored`,
      },
      { v: fmtInt(S.pages), l: "Screens modelled", n: "one page object each" },
      {
        v: fmtInt(S.selectors),
        l: "Selectors catalogued",
        n: `${S.parameterizedSelectors} parameterised`,
      },
      {
        v: fmtInt(S.verbs),
        l: "Harness verbs",
        n: "the moz* primitive library",
      },
      { v: fmtInt(S.edges), l: "Navigation edges", n: "routable by BFS" },
      { v: fmtInt(S.bugs), l: "Bugzilla bugs", n: "tracking conversions" },
    ];
    const row = document.getElementById("kpi-row");
    kpis.forEach(k => {
      const tile = html("div", "kpi");
      tile.appendChild(html("span", "kpi-value", k.v));
      tile.appendChild(html("span", "kpi-label", k.l));
      tile.appendChild(html("span", "kpi-note", k.n));
      row.appendChild(tile);
    });
  }

  function renderProgress() {
    const t = D.timeline;
    mount("chart-cumulative", (c, w) =>
      lineChart(
        c,
        w,
        t.map(p => ({
          y: p.cumulative,
          label: fmtMonth(p.month),
          tipTitle: fmtMonth(p.month),
          tipRows: [
            { label: "Cumulative", value: fmtInt(p.cumulative) },
            { label: "Added this month", value: `+${fmtInt(p.added)}` },
          ],
        }))
      )
    );

    mount("chart-monthly", (c, w) =>
      columnChart(
        c,
        w,
        t.map(p => ({
          value: p.added,
          label: fmtMonth(p.month),
          tipTitle: fmtMonth(p.month),
          tipRows: [
            { label: "Converted", value: fmtInt(p.added) },
            { label: "Running total", value: fmtInt(p.cumulative) },
          ],
        }))
      )
    );
  }

  function renderAreas() {
    const c1 = token("--series-1");
    const gray = token("--de-emphasis");
    const areas = D.areas.filter(a => a.smokeConverted > 0);
    const hidden = D.areas.filter(a => a.smokeConverted === 0);

    const legend = document.getElementById("areas-legend");
    legend.innerHTML = "";
    [
      { name: "Converted", color: c1 },
      { name: "Not yet converted", color: gray },
    ].forEach(s => {
      const item = html("span", "legend-item");
      const sw = html("span", "legend-swatch");
      sw.style.background = s.color;
      item.appendChild(sw);
      item.appendChild(document.createTextNode(s.name));
      legend.appendChild(item);
    });

    mount("chart-areas", (c, w) =>
      hBars(
        c,
        w,
        areas.map(a => ({
          label: a.area.replace(/Test$/, ""),
          segments: [
            { value: a.smokeConverted, color: c1, name: "Converted" },
            {
              value: a.smokeActive - a.smokeConverted,
              color: gray,
              name: "Remaining",
            },
          ],
          endLabel: `${a.smokeConverted}/${a.smokeActive}`,
          tipRows: [
            {
              label: "Smoke converted",
              value: fmtInt(a.smokeConverted),
              color: c1,
            },
            {
              label: "Smoke remaining",
              value: fmtInt(a.smokeActive - a.smokeConverted),
              color: gray,
            },
            { label: "Disabled (@Ignore)", value: fmtInt(a.smokeIgnored) },
            { label: "All @Test in class", value: fmtInt(a.total) },
          ],
        })),
        { barH: 17, gap: 11 }
      )
    );

    const remaining = D.areas.reduce(
      (s, a) => s + (a.smokeActive - a.smokeConverted),
      0
    );
    const untouched = hidden.reduce((s, a) => s + a.smokeActive, 0);
    document.getElementById("areas-foot").textContent =
      `All ${areas.length} legacy classes with at least one converted smoke test are shown. ` +
      `A further ${hidden.length} classes (${fmtInt(untouched)} active smoke tests) have none yet; ` +
      `${fmtInt(remaining)} active legacy smoke tests remain overall.`;
  }

  function renderEconomy() {
    const c1 = token("--series-1");
    const gray = token("--de-emphasis");

    mount("chart-loc", (c, w) =>
      hBars(
        c,
        w,
        [
          {
            label: "Legacy test",
            segments: [
              { value: S.avgConvertedLegacyLoc, color: gray, name: "Lines" },
            ],
            endLabel: `${S.avgConvertedLegacyLoc} lines`,
            tipRows: [
              {
                label: "Mean body length",
                value: `${S.avgConvertedLegacyLoc} lines`,
                color: gray,
              },
            ],
          },
          {
            label: "TAE replacement",
            segments: [
              { value: S.avgReplacementLoc, color: c1, name: "Lines" },
            ],
            endLabel: `${S.avgReplacementLoc} lines`,
            tipRows: [
              {
                label: "Mean body length",
                value: `${S.avgReplacementLoc} lines`,
                color: c1,
              },
            ],
          },
        ],
        { barH: 22, gap: 16, minLabelW: 118 }
      )
    );

    mount("chart-layers", (c, w) =>
      hBars(
        c,
        w,
        D.layers
          .filter(l => l.lines > 0)
          .map(l => ({
            label: l.layer,
            segments: [
              {
                value: l.lines,
                color: l.layer === "tests" ? c1 : gray,
                name: "Lines",
              },
            ],
            endLabel: fmtInt(l.lines),
            endLabelMuted: l.layer !== "tests",
            tipRows: [
              {
                label: "Lines",
                value: fmtInt(l.lines),
                color: l.layer === "tests" ? c1 : gray,
              },
              { label: "Files", value: fmtInt(l.files) },
            ],
          })),
        { barH: 15, gap: 9, minLabelW: 96 }
      )
    );

    const shareShared = Math.round(
      (S.sharedLines / (S.sharedLines + S.testLines)) * 100
    );
    const drop = Math.round(
      ((S.avgConvertedLegacyLoc - S.avgReplacementLoc) /
        S.avgConvertedLegacyLoc) *
        100
    );
    const side = document.getElementById("econ-side");
    const stats = [
      {
        v: `${drop}% shorter`,
        l: `A converted test averages ${S.avgReplacementLoc} lines against the ${S.avgConvertedLegacyLoc} lines of the legacy test it replaced.`,
      },
      {
        v: `${shareShared}% shared`,
        l: `${fmtInt(S.sharedLines)} of ${fmtInt(S.sharedLines + S.testLines)} Kotlin lines sit in the reusable layers, not in test bodies.`,
      },
      {
        v: `${(S.selectors / S.pages).toFixed(1)} per screen`,
        l: `${fmtInt(S.selectors)} selectors across ${S.catalogs} catalogues — centralised, so a UI change is fixed once.`,
      },
    ];
    const screenDrop = Math.round(
      ((S.robotLinesPerScreen - S.pageModelLinesPerScreen) /
        S.robotLinesPerScreen) *
        100
    );
    stats.push(
      {
        v: `${screenDrop}% less per screen`,
        l: `Modelling a screen takes ${S.pageModelLinesPerScreen} lines of page object + selectors, against ${S.robotLinesPerScreen} lines per robot in the legacy layer (${fmtInt(S.robotLines)} lines across ${S.robotFiles} robots).`,
      },
      {
        v: `${fmtInt(S.legacyToolkitCalls)} → ${fmtInt(S.taeToolkitCalls)}`,
        l: `Direct Espresso/UIAutomator/Compose calls in test bodies: ${fmtInt(S.legacyToolkitCalls)} across ${S.legacyToolkitFiles} of ${S.legacyTestFiles} legacy test files, versus ${fmtInt(S.taeToolkitCalls)} in ${S.taeToolkitFiles} of ${S.taeTestFiles} TAE files. The toolkit stays behind the harness.`,
      }
    );
    stats.forEach((s, i) => {
      if (i) {
        side.appendChild(html("div", "econ-divider"));
      }
      const blk = html("div");
      blk.appendChild(html("div", "econ-stat-value", s.v));
      blk.appendChild(html("div", "econ-stat-label", s.l));
      side.appendChild(blk);
    });
  }

  function renderSurface() {
    const colors = {
      Compose: token("--series-1"),
      Espresso: token("--series-2"),
      UIAutomator: token("--series-3"),
    };
    document.getElementById("strategies-sub").textContent =
      `${fmtInt(S.selectors)} catalogued selectors, ${D.selectorStrategies.length} distinct strategies`;

    const byFamily = {};
    D.selectorStrategies.forEach(s => {
      byFamily[s.family] = byFamily[s.family] || { count: 0, kinds: 0 };
      byFamily[s.family].count += s.count;
      byFamily[s.family].kinds += 1;
    });

    mount("chart-strategies", (c, w) =>
      hBars(
        c,
        w,
        Object.keys(byFamily)
          .sort((a, b) => byFamily[b].count - byFamily[a].count)
          .map(f => ({
            label: f,
            segments: [{ value: byFamily[f].count, color: colors[f], name: f }],
            endLabel: `${byFamily[f].count}  ·  ${Math.round((byFamily[f].count / S.selectors) * 100)}%`,
            tipRows: [
              {
                label: "Selectors",
                value: fmtInt(byFamily[f].count),
                color: colors[f],
              },
              {
                label: "Distinct strategies",
                value: fmtInt(byFamily[f].kinds),
              },
            ],
          })),
        { barH: 22, gap: 15, minLabelW: 104 }
      )
    );

    const deg = {};
    D.edges.forEach(e => {
      deg[e.from] = deg[e.from] || { out: 0, in: 0 };
      deg[e.to] = deg[e.to] || { out: 0, in: 0 };
      deg[e.from].out += 1;
      deg[e.to].in += 1;
    });
    const hubs = Object.keys(deg)
      .map(k => ({ name: k, ...deg[k], total: deg[k].in + deg[k].out }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const c1 = token("--series-1");
    const c2 = token("--series-2");
    mount("chart-hubs", (c, w) => {
      const legend = html("div", "legend");
      [
        { name: "Inbound", color: c1 },
        { name: "Outbound", color: c2 },
      ].forEach(s => {
        const item = html("span", "legend-item");
        const sw = html("span", "legend-swatch");
        sw.style.background = s.color;
        item.appendChild(sw);
        item.appendChild(document.createTextNode(s.name));
        legend.appendChild(item);
      });
      c.appendChild(legend);
      hBars(
        c,
        w,
        hubs.map(h => ({
          label: h.name.replace(/Page$/, ""),
          segments: [
            { value: h.in, color: c1, name: "Inbound" },
            { value: h.out, color: c2, name: "Outbound" },
          ],
          endLabel: String(h.total),
          tipRows: [
            { label: "Inbound edges", value: fmtInt(h.in), color: c1 },
            { label: "Outbound edges", value: fmtInt(h.out), color: c2 },
          ],
        })),
        { barH: 16, gap: 10, minLabelW: 96 }
      );
    });
  }

  function renderPrimitives() {
    const c1 = token("--series-1");
    const cats = D.primitiveCategories;
    document.getElementById("prim-sub").textContent =
      `${S.verbs} verbs plus ${S.primitives - S.verbs} lifecycle hooks, on BasePage and BaseTest`;

    const byCat = {};
    D.primitives.forEach(p => {
      (byCat[p.category] = byCat[p.category] || []).push(p);
    });

    mount("chart-primitives", (c, w) =>
      hBars(
        c,
        w,
        cats.map(k => ({
          label: k.category,
          segments: [{ value: k.count, color: c1, name: k.category }],
          endLabel: String(k.count),
          tipRows: (byCat[k.category] || [])
            .slice(0, 10)
            .map(p => ({ label: p.name, value: "" })),
        })),
        { barH: 19, gap: 13, minLabelW: 100 }
      )
    );

    const list = document.getElementById("prim-list");
    list.innerHTML = "";
    cats.forEach(k => {
      const group = html("div", "prim-group");
      const head = html("div", "prim-group-head");
      const dot = html("span", "tag-dot");
      dot.style.background = c1;
      head.appendChild(dot);
      head.appendChild(html("span", "prim-group-name", k.category));
      head.appendChild(html("span", "prim-group-count", String(k.count)));
      group.appendChild(head);
      const verbs = html("div", "prim-verbs");
      (byCat[k.category] || []).forEach(p => {
        const chip = html("code", "prim-verb", p.name);
        chip.title = `${p.name} — defined in ${p.source}`;
        verbs.appendChild(chip);
      });
      group.appendChild(verbs);
      list.appendChild(group);
    });
  }

  // Sequential single-hue ramps, low -> high, stepped evenly and selected per
  // surface. Slot 0 is the zero step and is allowed to recede toward the
  // surface, as a sequential (not ordinal) scale permits.
  const HEAT_RAMP_LIGHT = [
    "#f4f7fb",
    "#b7d3f6",
    "#86b6ef",
    "#5598e7",
    "#2a78d6",
    "#1c5cab",
    "#104281",
  ];
  const HEAT_RAMP_DARK = [
    "#1f242b",
    "#104281",
    "#1c5cab",
    "#2a78d6",
    "#5598e7",
    "#86b6ef",
    "#b7d3f6",
  ];

  /** Relative luminance, so a label inside a filled cell always clears contrast. */
  function isDarkFill(hex) {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.36;
  }

  function renderHeatmap() {
    const COLS = [
      { key: "selectors", label: "Selectors" },
      { key: "groups", label: "Groups" },
      { key: "inbound", label: "Edges in" },
      { key: "outbound", label: "Edges out" },
      { key: "usage", label: "Test uses" },
      { key: "lines", label: "Lines" },
    ];
    const body = document.getElementById("heat-body");
    const filterEl = document.getElementById("heat-filter");

    function draw(q) {
      const dark = document.documentElement.getAttribute("data-theme")
        ? document.documentElement.getAttribute("data-theme") === "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches;
      const ramp = dark ? HEAT_RAMP_DARK : HEAT_RAMP_LIGHT;
      const needle = q.trim().toLowerCase();
      const rows = D.heatmap.filter(
        r => !needle || r.page.toLowerCase().includes(needle)
      );
      // Each column carries its own scale: the units are not comparable.
      const maxes = {};
      COLS.forEach(c => {
        maxes[c.key] = Math.max(1, ...D.heatmap.map(r => r[c.key]));
      });

      body.innerHTML = "";
      if (!rows.length) {
        const tr = html("tr", "empty-row");
        const td = html("td", null, "No screens match that filter.");
        td.colSpan = COLS.length + 1;
        tr.appendChild(td);
        body.appendChild(tr);
        return;
      }

      rows.forEach(r => {
        const tr = html("tr");
        const th = html("th", "heat-screen", r.page.replace(/Page$/, ""));
        th.scope = "row";
        tr.appendChild(th);
        COLS.forEach(c => {
          const v = r[c.key];
          const t = v / maxes[c.key];
          const step = v === 0 ? 0 : 1 + Math.round(t * (ramp.length - 2));
          const fill = ramp[step];
          const td = html("td", "heat-cell", fmtInt(v));
          td.style.background = fill;
          // A label inside a filled cell takes white or ink by the fill's
          // luminance, so it always clears contrast.
          let ink = "var(--text-muted)";
          if (v > 0) {
            ink = isDarkFill(fill) ? "#ffffff" : "#0b0b0b";
          }
          td.style.color = ink;
          td.title = `${r.page} — ${c.label}: ${fmtInt(v)} (column max ${fmtInt(maxes[c.key])})`;
          tr.appendChild(td);
        });
        body.appendChild(tr);
      });
    }

    // Scale legend, so the ramp is readable as an encoding rather than decoration.
    function drawScale() {
      const dark = document.documentElement.getAttribute("data-theme")
        ? document.documentElement.getAttribute("data-theme") === "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches;
      const ramp = dark ? HEAT_RAMP_DARK : HEAT_RAMP_LIGHT;
      const box = document.getElementById("heat-scale");
      box.innerHTML = "";
      box.appendChild(html("span", "heat-scale-label", "less"));
      const strip = html("span", "heat-strip");
      ramp.forEach(c => {
        const cell = html("span", "heat-strip-cell");
        cell.style.background = c;
        strip.appendChild(cell);
      });
      box.appendChild(strip);
      box.appendChild(html("span", "heat-scale-label", "more"));
    }

    filterEl.addEventListener("input", () => draw(filterEl.value));
    heatRedraw = () => {
      draw(filterEl.value);
      drawScale();
    };
    draw("");
    drawScale();

    document.getElementById("heat-foot").textContent =
      `${D.heatmap.length} modelled screens. ${S.pagesUnusedByTests} are not yet reached by any test ` +
      `via its on.* handle — modelled, but unexercised. All ${fmtInt(S.selectors)} selectors resolve to a page.`;
  }

  let heatRedraw = () => {};

  function renderIntegrity() {
    const box = document.getElementById("integrity");
    const bad = D.badPointers || [];
    const ok = S.totalPointers - bad.length;

    const banner = html("div", "integrity-banner");
    const icon = el("svg", {
      class: "integrity-icon",
      viewBox: "0 0 20 20",
      "aria-hidden": "true",
    });
    const color = bad.length
      ? token("--status-critical")
      : token("--status-good");
    icon.appendChild(
      el("circle", {
        cx: 10,
        cy: 10,
        r: 9,
        fill: "none",
        stroke: color,
        "stroke-width": 2,
      })
    );
    if (bad.length) {
      icon.appendChild(
        el("path", {
          d: "M10 5.5v5.5",
          stroke: color,
          "stroke-width": 2,
          "stroke-linecap": "round",
        })
      );
      icon.appendChild(
        el("circle", { cx: 10, cy: 14.4, r: 1.15, fill: color })
      );
    } else {
      icon.appendChild(
        el("path", {
          d: "M6 10.3l2.7 2.7L14 7.6",
          fill: "none",
          stroke: color,
          "stroke-width": 2,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        })
      );
    }
    banner.appendChild(icon);
    const txt = html("div");
    txt.appendChild(
      html(
        "p",
        "integrity-title",
        bad.length
          ? `${bad.length} of ${S.totalPointers} pointers need attention`
          : `All ${S.totalPointers} pointers check out`
      )
    );
    txt.appendChild(
      html(
        "p",
        "integrity-text",
        bad.length
          ? `${ok} pointers resolve to a live TAE test and are claimed once. The rest either name a class that does not hold the method they point at, or resolve cleanly but are claimed by two legacy tests — which leaves the TAE test that should have been named unclaimed. See docs/conversion-bookkeeping-pitfalls.md.`
          : "Every @Converted annotation names a real, non-ignored TAE test, claimed exactly once."
      )
    );
    banner.appendChild(txt);
    box.appendChild(banner);

    if (!bad.length) {
      return;
    }

    const list = html("ul", "finding-list");
    bad.forEach(b => {
      const li = html("li", "finding");
      const head = html("div", "finding-head");
      const tag = html("span", "tag");
      const dot = html("span", "tag-dot");
      dot.style.background = token("--status-critical");
      tag.appendChild(dot);
      tag.appendChild(
        document.createTextNode(POINTER_LABELS[b.status].finding)
      );
      head.appendChild(tag);
      head.appendChild(html("span", "finding-name", b.legacy));
      li.appendChild(head);

      const detail = html("p", "finding-detail");
      const ptr = b.pointer.replace(
        "org.mozilla.fenix.ui.efficiency.tests.",
        ""
      );
      if (b.status === "wrong-class") {
        detail.appendChild(document.createTextNode("Points at "));
        detail.appendChild(html("code", null, ptr));
        detail.appendChild(
          document.createTextNode(", but that method lives in ")
        );
        detail.appendChild(html("code", null, b.actualClass));
        detail.appendChild(document.createTextNode("."));
      } else if (b.status === "double-claim") {
        detail.appendChild(
          document.createTextNode(
            `${b.claimants.length} legacy tests both name `
          )
        );
        detail.appendChild(html("code", null, ptr));
        detail.appendChild(
          document.createTextNode(
            ". It resolves, so it passes an existence check — but one of the two is a copy-paste, and the TAE test that should have been named is left unclaimed."
          )
        );
      } else {
        detail.appendChild(document.createTextNode("Points at "));
        detail.appendChild(html("code", null, ptr));
        detail.appendChild(
          document.createTextNode(
            b.status === "missing"
              ? ", which does not exist in the TAE suite."
              : ", which is @Ignore'd."
          )
        );
      }
      li.appendChild(detail);
      list.appendChild(li);
    });
    box.appendChild(list);
  }

  function renderLedger() {
    const body = document.getElementById("ledger-body");
    const count = document.getElementById("ledger-count");
    const filter = document.getElementById("ledger-filter");
    const rows = D.conversions;

    function statusOf(c) {
      const bad = c.targets.find(t => t.status !== "ok");
      return bad ? bad.status : "ok";
    }

    function draw(q) {
      const needle = q.trim().toLowerCase();
      const shown = rows.filter(c => {
        if (!needle) {
          return true;
        }
        return (
          c.legacy.toLowerCase().includes(needle) ||
          String(c.bug).includes(needle) ||
          c.since.includes(needle) ||
          c.targets.some(t => t.pointer.toLowerCase().includes(needle))
        );
      });

      body.innerHTML = "";
      count.textContent = `${shown.length} of ${rows.length} conversions`;

      if (!shown.length) {
        const tr = html("tr", "empty-row");
        const td = html("td", null, "No conversions match that filter.");
        td.colSpan = 5;
        tr.appendChild(td);
        body.appendChild(tr);
        return;
      }

      shown.forEach(c => {
        const tr = html("tr");

        const legacy = html("td", "mono", c.legacy);
        tr.appendChild(legacy);

        const repl = html("td", "mono");
        c.targets.forEach((t, i) => {
          if (i) {
            repl.appendChild(html("br"));
          }
          repl.appendChild(
            document.createTextNode(
              t.pointer.replace("org.mozilla.fenix.ui.efficiency.tests.", "")
            )
          );
        });
        tr.appendChild(repl);

        const bug = html("td", "mono dim", c.bug ? String(c.bug) : "—");
        tr.appendChild(bug);

        tr.appendChild(html("td", "dim", c.since ? fmtMonth(c.since) : "—"));

        const st = statusOf(c);
        const td = html("td");
        const pill = html("span", "status-pill");
        const dot = html("span", "tag-dot");
        dot.style.background =
          st === "ok" ? token("--status-good") : token("--status-critical");
        pill.appendChild(dot);
        pill.appendChild(document.createTextNode(POINTER_LABELS[st].ledger));
        td.appendChild(pill);
        tr.appendChild(td);

        if (c.notes) {
          tr.title = c.notes;
        }
        body.appendChild(tr);
      });
    }

    filter.addEventListener("input", () => draw(filter.value));
    draw("");
  }

  // ------------------------------------------------------------------ theme

  function initTheme() {
    const btn = document.getElementById("theme-toggle");
    const icon = btn.querySelector("[data-theme-icon]");
    const stored = localStorage.getItem("tae-theme");
    if (stored) {
      document.documentElement.setAttribute("data-theme", stored);
    }

    function currentIsDark() {
      const set = document.documentElement.getAttribute("data-theme");
      return set
        ? set === "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches;
    }

    function sync() {
      icon.textContent = currentIsDark() ? "☀" : "☽";
    }

    btn.addEventListener("click", () => {
      const next = currentIsDark() ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("tae-theme", next);
      sync();
      redrawAll();
      // Re-run the panels whose colours are read from tokens at draw time.
      document.getElementById("integrity").innerHTML = "";
      renderIntegrity();
      heatRedraw();
    });

    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        sync();
        redrawAll();
        heatRedraw();
      });
    sync();
  }

  renderHeadline();
  renderPrimitives();
  renderHeatmap();
  renderProgress();
  renderAreas();
  renderEconomy();
  renderSurface();
  renderIntegrity();
  renderLedger();
  initTheme();
})();
