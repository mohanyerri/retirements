/* Minimal SVG charts: stacked area, fan (percentile bands), stacked bars + line.
   Hover tooltips use native <title> elements on invisible column rects. */
window.RP = window.RP || {};
(function (RP) {
  'use strict';
  const W = 820, H = 300, M = { l: 66, r: 14, t: 14, b: 28 };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Colours are CSS variables (css/styles.css) so charts follow the palette and light/dark mode.
  RP.COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];
  RP.THEME = {
    primary: 'var(--c1)', navy: 'var(--c2)', saffron: 'var(--c3)', sandy: 'var(--c4)', sienna: 'var(--c5)',
    median: 'var(--c-median)', neutral: 'var(--c-neutral)',
    tint: (c, pct) => `color-mix(in srgb, ${c} ${pct}%, transparent)`,
  };
  const T = RP.THEME;

  function niceMax(v) {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  function frame(x0, x1, yMax, fmt, markerX) {
    if (x1 <= x0) x1 = x0 + 1;
    const X = x => M.l + (x - x0) / (x1 - x0) * (W - M.l - M.r);
    const Y = y => H - M.b - (y / yMax) * (H - M.t - M.b);
    let g = '';
    for (let k = 0; k <= 4; k++) {
      const v = yMax * k / 4, yy = Y(v);
      g += `<line class="grid" x1="${M.l}" x2="${W - M.r}" y1="${yy}" y2="${yy}"/>`
        + `<text class="ylab" x="${M.l - 6}" y="${yy + 4}" text-anchor="end">${esc(fmt(v))}</text>`;
    }
    const span = x1 - x0, step = span > 40 ? 10 : span > 15 ? 5 : span > 6 ? 2 : 1;
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      g += `<text class="xlab" x="${X(x)}" y="${H - 8}" text-anchor="middle">${x}</text>`;
    }
    if (markerX != null && markerX > x0 && markerX < x1) {
      g += `<line class="marker" x1="${X(markerX)}" x2="${X(markerX)}" y1="${M.t}" y2="${H - M.b}"/>`
        + `<text class="mlab" x="${X(markerX) + 4}" y="${M.t + 10}">Retire</text>`;
    }
    return { X, Y, g };
  }

  // Invisible hover columns; the popup content comes from o.tip(k) via the UI layer.
  function hoverCols(xs, X, pad = 0) {
    let h = '';
    for (let k = 0; k < xs.length; k++) {
      const left = k === 0 ? X(xs[0] - pad) : (X(xs[k - 1]) + X(xs[k])) / 2;
      const right = k === xs.length - 1 ? X(xs[k] + pad) : (X(xs[k]) + X(xs[k + 1])) / 2;
      h += `<g class="col" data-k="${k}"><rect class="hover" x="${left}" y="${M.t}" width="${Math.max(1, right - left)}" height="${H - M.t - M.b}"/>`
        + `<line class="guide" x1="${X(xs[k])}" x2="${X(xs[k])}" y1="${M.t}" y2="${H - M.b}"/></g>`;
    }
    return h;
  }
  function attach(el, o) { el._tip = o.tip || null; el.dataset.chart = '1'; }
  // o.animate → entrance animation: areas/lines draw in left→right, bars grow up in sequence (CSS in styles.css)
  const svg = (inner, animate) => `<svg viewBox="0 0 ${W} ${H}" class="chart${animate ? ' anim-draw' : ''}" role="img">${inner}</svg>`;
  const legend = items => '<div class="legend">' + items.map(i =>
    `<span><i style="background:${i.color}${i.dash ? ';height:2px' : ''}"></i>${esc(i.name)}</span>`).join('') + '</div>';
  const poly = (pts, attrs) => `<polygon points="${pts.join(' ')}" ${attrs}/>`;
  const line = (pts, attrs) => `<polyline points="${pts.join(' ')}" fill="none" ${attrs}/>`;

  function stackedArea(el, o) {
    const n = o.xs.length;
    let base = new Array(n).fill(0);
    const layers = o.series.map(s => {
      const top = base.map((b, k) => b + Math.max(0, s.values[k] || 0));
      const layer = { s, base, top }; base = top; return layer;
    });
    const f = frame(o.xs[0], o.xs[n - 1], niceMax(Math.max(...base)), o.fmt, o.markerX);
    let paths = '';
    for (const { s, base: b, top } of layers) {
      const up = o.xs.map((x, k) => `${f.X(x)},${f.Y(top[k])}`);
      const dn = o.xs.map((x, k) => `${f.X(x)},${f.Y(b[k])}`).reverse();
      paths += poly(up.concat(dn), `style="fill:${s.color}" fill-opacity="0.88"`);
    }
    el.innerHTML = svg(f.g + `<g class="series">${paths}</g>` + hoverCols(o.xs, f.X), o.animate) + legend(o.series);
    attach(el, o);
  }

  function fan(el, o) {
    const n = o.xs.length;
    const f = frame(o.xs[0], o.xs[n - 1], niceMax(Math.max(...o.p90, ...(o.line || [0]))), o.fmt, o.markerX);
    const pts = arr => o.xs.map((x, k) => `${f.X(x)},${f.Y(arr[k])}`);
    const band = (lo, hi, op) => poly(pts(hi).concat(pts(lo).reverse()), `style="fill:${T.primary}" fill-opacity="${op}"`);
    let g = band(o.p10, o.p90, 0.16) + band(o.p25, o.p75, 0.28) + line(pts(o.p50), `style="stroke:${T.median}" stroke-width="2.5"`);
    if (o.line) g += line(pts(o.line), `style="stroke:${T.sandy}" stroke-width="2" stroke-dasharray="6 4"`);
    el.innerHTML = svg(f.g + `<g class="series">${g}</g>` + hoverCols(o.xs, f.X), o.animate) + legend([
      { name: 'Median', color: T.median }, { name: '25th–75th percentile', color: T.tint(T.primary, 45) },
      { name: '10th–90th percentile', color: T.tint(T.primary, 20) }, ...(o.line ? [{ name: 'Fixed-return projection', color: T.sandy, dash: true }] : []),
    ]);
    attach(el, o);
  }

  function stackedBars(el, o) {
    const n = o.xs.length;
    if (!n) { el.innerHTML = '<p class="muted">No data.</p>'; return; }
    const totals = o.xs.map((_, k) => o.series.reduce((t, s) => t + Math.max(0, s.values[k] || 0), 0));
    const f = frame(o.xs[0] - 0.5, o.xs[n - 1] + 0.5, niceMax(Math.max(...totals, ...(o.line ? o.line.values : [0]))), o.fmt, o.markerX != null ? o.markerX - 0.5 : null);
    const bw = Math.max(1, (f.X(1) - f.X(0)) * 0.72);
    let g = '';
    o.xs.forEach((x, k) => {
      let acc = 0;
      for (const s of o.series) {
        const v = Math.max(0, s.values[k] || 0);
        if (v <= 0) continue;
        const y1 = f.Y(acc + v), y0 = f.Y(acc);
        g += `<rect class="bar" x="${f.X(x) - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(0, y0 - y1)}" style="fill:${s.color};--d:${Math.round(k / n * 700)}ms"/>`;
        acc += v;
      }
    });
    const ln = o.line ? `<g class="series">${line(o.xs.map((x, k) => `${f.X(x)},${f.Y(o.line.values[k])}`), `style="stroke:${o.line.color}" stroke-width="2.5"`)}</g>` : '';
    el.innerHTML = svg(f.g + `<g class="bars">${g}</g>` + ln + hoverCols(o.xs, f.X, 0.5), o.animate) + legend([...o.series, ...(o.line ? [o.line] : [])]);
    attach(el, o);
  }

  RP.charts = { stackedArea, fan, stackedBars, niceMax };
})(window.RP);
