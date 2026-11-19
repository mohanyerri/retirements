/* Bucket planner visuals: animated SVG buckets, required-return gauge, optimiser heatmap,
   count-up numbers and the "Play your retirement" simulator. DOM only (not loaded by Node tests). */
window.RP = window.RP || {};
(function (RP) {
  'use strict';
  const RM = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const F = () => RP.fmt;
  const COLORS = () => [RP.THEME.saffron, RP.THEME.navy, RP.THEME.primary];   // Safety, Income, Growth
  const ease = t => 1 - Math.pow(1 - t, 3);
  let uid = 0;

  // ------------------------------------------------------------------ buckets
  // Visual order left → right: Growth (k=2) → Income (k=1) → Safety (k=0) → your income tap.
  const W = 960, H = 360, BW = 220, TOP = 86, BOT = 300;
  const XS = { 2: 40, 1: 330, 0: 620 };
  const shape = x => `M${x} ${TOP} L${x + BW} ${TOP} L${x + BW - 20} ${BOT - 16} Q${x + BW - 23} ${BOT} ${x + BW - 40} ${BOT} L${x + 40} ${BOT} Q${x + 23} ${BOT} ${x + 20} ${BOT - 16} Z`;
  function wavePath(x) {
    let d = `M${x - 220} ${TOP + 6}`;
    for (let i = 0; i < 8; i++) d += ' q 27.5 -7 55 0 t 55 0';
    return d + ` L${x - 220 + 880} ${BOT + 400} L${x - 220} ${BOT + 400} Z`;
  }

  function drawBuckets(el, view, opts = {}) {
    if (!el._b) {
      const id = 'bk' + (++uid);
      let svg = `<svg viewBox="0 0 ${W} ${H}" class="b-svg" role="img" aria-label="Your three retirement buckets"><defs>`;
      [0, 1, 2].forEach(k => { svg += `<clipPath id="${id}c${k}"><path d="${shape(XS[k])}"/></clipPath>`; });
      svg += '</defs>';
      // pipes (behind buckets)
      const pipe = (d, cls) => `<path class="b-pipe" d="${d}"/><path class="b-flow ${cls}" d="${d}"/>`;
      svg += `<g class="b-pipes">`
        + pipe(`M${XS[2] + BW - 24} 250 L${XS[1] + 24} 250`, 'p32')
        + pipe(`M${XS[1] + BW - 24} 250 L${XS[0] + 24} 250`, 'p21')
        + pipe(`M${XS[0] + BW - 24} 262 L905 262 L905 300`, 'p1o')
        + `<text class="b-pipe-l" x="${(XS[2] + BW + XS[1]) / 2}" y="238" text-anchor="middle">refill</text>`
        + `<text class="b-pipe-l" x="${(XS[1] + BW + XS[0]) / 2}" y="238" text-anchor="middle">refill</text></g>`;
      [2, 1, 0].forEach(k => {
        const x = XS[k];
        svg += `<g class="b-bucket" data-k="${k}">`
          + `<text class="b-name" x="${x + BW / 2}" y="26" text-anchor="middle"></text>`
          + `<text class="b-amt" x="${x + BW / 2}" y="60" text-anchor="middle"></text>`
          + `<path class="b-glass" d="${shape(x)}"/>`
          + `<g clip-path="url(#${id}c${k})"><g class="b-liquid" style="transform: translateY(${BOT - TOP}px)">`
          + `<path class="b-wave" d="${wavePath(x)}" style="fill:${COLORS()[k]}"/>`
          + `<path class="b-wave b-wave2" d="${wavePath(x)}" style="fill:${COLORS()[k]}"/>`
          + `</g></g>`
          + `<path class="b-rim" d="${shape(x)}"/>`
          + `<text class="b-share" x="${x + BW / 2}" y="${(TOP + BOT) / 2 + 10}" text-anchor="middle"></text>`
          + `<rect class="b-hit" data-tip="${k}" x="${x}" y="${TOP - 70}" width="${BW}" height="${BOT - TOP + 70}"/></g>`;
      });
      // income tap + drops
      svg += `<g class="b-tap"><rect x="893" y="296" width="24" height="12" rx="3"/>`
        + [0, 1, 2].map(i => `<circle class="b-drop" style="animation-delay:${i * 0.45}s" cx="905" cy="314" r="4.5"/>`).join('')
        + `<text class="b-inc-l" x="905" y="346" text-anchor="middle">Your income</text></g>`;
      svg += '</svg>';
      el.innerHTML = svg + (opts.compact ? '' : '<div class="b-cards"></div>');
      el._b = { levels: [0, 0, 0], view: null };
      el.dataset.tiphost = '1';
    }
    el._cellTip = key => (opts.tip ? opts.tip(+key) : null);
    el._b.view = view;
    el._b.compact = !!opts.compact;
    const svg = el.querySelector('svg');
    const total = view.reduce((t, v) => t + v.amount, 0);
    view.forEach(v => {
      const g = svg.querySelector(`.b-bucket[data-k="${v.k}"]`);
      g.querySelector('.b-name').textContent = `${v.k + 1} · ${v.name}`;
      countUp(g.querySelector('.b-amt'), v.amount, x => F().short(x));
      g.querySelector('.b-share').textContent = total > 0 ? F().pct(v.amount / total, 0) : '';
    });
    svg.querySelector('.b-inc-l').textContent = opts.income ? `${F().short(opts.income)} / month` : 'Your income';
    // Each bucket is shown funded to its own target (85% full); amounts and shares carry the size.
    // The player re-scales against each bucket's own peak so draining and refilling stay visible.
    el._b.caps = view.map(v => Math.max(v.amount, 1) / 0.85);
    setLevels(el, { b: [view[0].amount, view[1].amount, view[2].amount], caps: el._b.caps, animate: true });
    if (!opts.compact) {
      el.querySelector('.b-cards').innerHTML = [2, 1, 0].map(k => {
        const v = view[k];
        return `<div class="b-card k${k}"><div class="b-card-h"><i style="background:${COLORS()[k]}"></i>${k + 1} · ${esc(v.name)}</div>`
          + `<div class="b-card-amt">${F().short(v.amount)} <span>${total > 0 ? F().pct(v.amount / total, 0) : ''}</span></div>`
          + `<div class="b-card-row"><span>Covers</span><b>${esc(v.years)}</b></div>`
          + `<div class="b-card-row"><span>Expected return</span><b>${v.ret}% a year</b></div>`
          + `<div class="b-card-inst">${esc(v.instruments)}</div></div>`;
      }).join('');
    }
  }

  /** frame: { b:[b1,b2,b3], caps?:[…], events?:[…], animate?:bool } */
  function setLevels(el, frame) {
    if (!el || !el._b) return;
    const svg = el.querySelector('svg');
    const caps = frame.caps || el._b.caps || [1, 1, 1];
    [0, 1, 2].forEach(k => {
      const lv = Math.max(0, Math.min(1, frame.b[k] / (caps[k] || 1)));
      const liq = svg.querySelector(`.b-bucket[data-k="${k}"] .b-liquid`);
      liq.classList.toggle('instant', !frame.animate);
      liq.style.transform = `translateY(${((1 - lv) * (BOT - TOP + 10)).toFixed(1)}px)`;
      if (!frame.animate) svg.querySelector(`.b-bucket[data-k="${k}"] .b-amt`).textContent = F().short(frame.b[k]);
      if (frame.showShare) {
        const tot = frame.b[0] + frame.b[1] + frame.b[2];
        svg.querySelector(`.b-bucket[data-k="${k}"] .b-share`).textContent = tot > 0 ? F().pct(frame.b[k] / tot, 0) : '';
      }
    });
    (frame.events || []).forEach(ev => pulsePipe(el, ev.from, ev.to));
    if (frame.paying != null) svg.classList.toggle('dry', !frame.paying);
  }

  function pulsePipe(el, from, to) {
    const map = { '32': ['.p32'], '21': ['.p21'], '31': ['.p32', '.p21'], '23': ['.p32'] };
    (map[`${from}${to}`] || []).forEach(sel => {
      const p = el.querySelector(sel);
      if (!p) return;
      p.classList.remove('pulse', 'reverse');
      void p.getBBox();
      if (from === 2 && to === 3) p.classList.add('reverse');
      p.classList.add('pulse');
      clearTimeout(p._t); p._t = setTimeout(() => p.classList.remove('pulse', 'reverse'), 900);
    });
  }

  // ------------------------------------------------------------------ count-up
  function countUp(el, to, fmt, dur = 900) {
    if (!el) return;
    cancelAnimationFrame(el._raf);
    if (RM() || !isFinite(to)) { el.textContent = fmt(to); el._v = to; return; }
    const from = el._v != null && isFinite(el._v) ? el._v : to * 0.6;
    const t0 = performance.now();
    const tick = t => {
      const p = Math.min(1, (t - t0) / dur);
      el.textContent = fmt(from + (to - from) * ease(p));
      if (p < 1) el._raf = requestAnimationFrame(tick); else el._v = to;
    };
    el._raf = requestAnimationFrame(tick);
  }

  // ------------------------------------------------------------------ gauge
  function gauge(el, required, expected) {
    const max = Math.max(0.15, Math.ceil(((isFinite(required) ? required : 0.15) + 0.02) * 20) / 20);
    const cx = 160, cy = 160, r = 120;
    const pt = v => { const a = Math.PI * (1 - Math.max(0, Math.min(1, v / max))); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
    const arc = (v0, v1) => { const [x0, y0] = pt(v0), [x1, y1] = pt(v1); return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
    const req = isFinite(required) ? Math.max(0, required) : max;
    const cls = !isFinite(required) ? 'danger' : expected == null ? 'warn' : expected - required >= 0.01 ? 'ok' : expected >= required ? 'warn' : 'danger';
    if (!el._g) {
      el.innerHTML = `<svg viewBox="0 0 320 232" class="b-gauge-svg"><path class="g-bg" d="${arc(0, max)}"/><path class="g-exp" d=""/>`
        + `<g class="g-ticks"></g><g class="g-needle" style="transform: rotate(-90deg)"><line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r + 18}"/><circle cx="${cx}" cy="${cy}" r="8"/></g>`
        + `<text class="g-val" x="${cx}" y="${cy + 46}" text-anchor="middle"></text><text class="g-lab" x="${cx}" y="${cy + 66}" text-anchor="middle">needed a year</text></svg>`;
      el._g = true;
    }
    const svg = el.querySelector('svg');
    svg.querySelector('.g-bg').setAttribute('d', arc(0, max));
    const exp = svg.querySelector('.g-exp');
    exp.setAttribute('d', expected != null && expected > 0 ? arc(0, Math.min(expected, max)) : '');
    exp.style.strokeDasharray = '800'; exp.style.strokeDashoffset = RM() ? '0' : '800';
    requestAnimationFrame(() => requestAnimationFrame(() => { exp.style.strokeDashoffset = '0'; }));
    let ticks = '';
    for (let v = 0; v <= max + 1e-9; v += 0.05) { const [x, y] = pt(v); const [x2, y2] = [cx + (x - cx) * 1.13, cy + (y - cy) * 1.13]; ticks += `<text x="${x2.toFixed(1)}" y="${(y2 + 4).toFixed(1)}" text-anchor="middle">${Math.round(v * 100)}%</text>`; }
    if (expected != null) { const [x, y] = pt(Math.min(expected, max)); ticks += `<circle class="g-expdot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6"><title>Expected ${(expected * 100).toFixed(1)}%</title></circle>`; }
    svg.querySelector('.g-ticks').innerHTML = ticks;
    const needle = svg.querySelector('.g-needle');
    needle.setAttribute('class', 'g-needle ' + cls);
    const deg = -90 + 180 * Math.min(1, req / max);
    requestAnimationFrame(() => { needle.style.transform = `rotate(${deg.toFixed(1)}deg)`; });
    svg.querySelector('.g-val').textContent = isFinite(required) ? (required * 100).toFixed(1) + '%' : 'n/a';
    svg.setAttribute('class', 'b-gauge-svg ' + cls);
  }

  // ------------------------------------------------------------------ heatmap
  // Colour relative to the grid's own range when results are close together, so small but real
  // differences stay visible; fall back to an absolute 50–95% scale when the spread is wide.
  function heatColor(s, lo = 0.5, hi = 0.95) {
    const t = Math.max(0, Math.min(1, (s - lo) / Math.max(1e-6, hi - lo)));
    return t < 0.5 ? `color-mix(in srgb, var(--c3) ${(t * 200).toFixed(0)}%, var(--c5))` : `color-mix(in srgb, var(--c1) ${((t - 0.5) * 200).toFixed(0)}%, var(--c3))`;
  }
  function heatmap(el, cells, { N1S, GAPS }) {
    let h = '<table class="b-heat"><thead><tr><th class="corner">Safety ↓ · Income →</th>' + GAPS.map(g => `<th>+${g} yrs</th>`).join('') + '</tr></thead><tbody>';
    N1S.forEach((n1, r) => {
      h += `<tr><th>${n1} yr${n1 === 1 ? '' : 's'}</th>`;
      GAPS.forEach((g, c) => { const i = r * GAPS.length + c; h += `<td data-cell="${i}" data-tip="${i}" class="pending"><span></span></td>`; });
      h += '</tr>';
    });
    el.innerHTML = h + '</tbody></table><div class="b-heat-legend"><span>Lower chance</span><i></i><span>Higher chance</span><span class="b-hl-out">Outside your risk comfort</span><span class="b-hl-inv">Not possible</span></div>';
    el._cells = cells;
    el.dataset.tiphost = '1';
    el._cellTip = key => cellTip(el._cells[+key]);
  }
  function cellTip(x) {
    if (!x) return null;
    const F_ = F(), sz = x.sz;
    if (!sz.valid) return RP.ui.tipHTML({ title: `${x.N1} yrs Safety + ${x.gap} yrs Income`, rows: [], notes: [sz.reason + '.'] });
    if (!x.res) return RP.ui.tipHTML({ title: `${x.N1} yrs Safety + ${x.gap} yrs Income`, rows: [], notes: ['Testing…'] });
    const tot = sz.B1 + sz.B2 + sz.B3;
    return RP.ui.tipHTML({
      title: `${x.N1} yr${x.N1 === 1 ? '' : 's'} Safety + ${x.gap} yrs Income`, chip: F_.pct(x.res.success, 0),
      rows: [
        { label: '1 · Safety', value: `${F_.short(sz.B1)} · ${F_.pct(sz.B1 / tot, 0)}`, color: COLORS()[0] },
        { label: '2 · Income', value: `${F_.short(sz.B2)} · ${F_.pct(sz.B2 / tot, 0)}`, color: COLORS()[1] },
        { label: '3 · Growth', value: `${F_.short(sz.B3)} · ${F_.pct(sz.B3 / tot, 0)}`, color: COLORS()[2] },
        null,
        { label: 'Chance money lasts', value: F_.pct(x.res.success, 1), cls: 'sub' },
        { label: "Median left (today's ₹)", value: F_.short(x.res.median) },
        { label: 'Expected return', value: F_.pct(sz.expected, 2) },
      ],
      notes: [sz.inRange ? 'Click to preview this split.' : 'Growth share is below your risk-comfort range. Click to preview anyway.'],
    });
  }
  function heatmapReveal(el, x) {
    const td = el.querySelector(`td[data-cell="${x.r * 8 + x.c}"]`);
    if (!td) return;
    td.classList.remove('pending');
    if (!x.sz.valid) { td.classList.add('invalid', 'in'); td.firstChild.textContent = '–'; return; }
    td._s = x.res.success;
    td.style.setProperty('--hc', heatColor(x.res.success));
    td.firstChild.textContent = Math.round(x.res.success * 100);
    if (!x.sz.inRange) td.classList.add('out');
    requestAnimationFrame(() => td.classList.add('in'));
  }
  /** After all cells are in: re-colour on the grid's own range (min → max) if results are close together. */
  function heatmapRescale(el) {
    const tds = Array.from(el.querySelectorAll('td[data-cell]')).filter(t => t._s != null);
    if (!tds.length) return;
    const lo = Math.min(...tds.map(t => t._s)), hi = Math.max(...tds.map(t => t._s));
    if (hi - lo >= 0.3 || hi - lo < 0.005) return;
    tds.forEach(t => t.style.setProperty('--hc', heatColor(t._s, lo - 0.01, hi)));
    const lg = el.querySelector('.b-heat-legend span');
    if (lg) lg.textContent = `${Math.round(lo * 100)}% (lowest here)`;
    const hg = el.querySelectorAll('.b-heat-legend span')[1];
    if (hg) hg.textContent = `${Math.round(hi * 100)}% (highest)`;
  }
  function heatmapChoose(el, x) {
    heatmapRescale(el);
    el.querySelectorAll('td.best').forEach(t => t.classList.remove('best'));
    const td = el.querySelector(`td[data-cell="${x.r * 8 + x.c}"]`);
    if (td) td.classList.add('best');
  }
  function heatmapFocus(el, x) {
    el.querySelectorAll('td.focus').forEach(t => t.classList.remove('focus'));
    const td = el.querySelector(`td[data-cell="${x.r * 8 + x.c}"]`);
    if (td) td.classList.add('focus');
  }

  // ------------------------------------------------------------------ player
  function createPlayer(el, opts) {
    el.innerHTML = `
      <div class="p-stage">
        <div class="p-diagram" id="${el.id}Diagram"></div>
        <div class="p-side">
          <div class="p-clock"><span class="p-age">Age —</span><span class="p-date"></span></div>
          <div class="p-total"><span>Total savings (today's ₹)</span><b class="p-tot">—</b></div>
          <ul class="p-ticker" aria-live="polite"></ul>
        </div>
      </div>
      <svg class="p-mini" viewBox="0 0 800 90" preserveAspectRatio="none"><defs><clipPath id="${el.id}Clip"><rect class="p-cliprect" x="0" y="0" width="0" height="90"/></clipPath></defs>
        <path class="p-area" clip-path="url(#${el.id}Clip)" d=""/><path class="p-line" clip-path="url(#${el.id}Clip)" d=""/><path class="p-ghost" d=""/><circle class="p-dot" r="5" cx="0" cy="0"/></svg>
      <div class="p-controls">
        <button class="p-play primary" aria-label="Play">▶ Play</button>
        <input class="p-slider" type="range" min="0" max="0" value="0" aria-label="Timeline">
        <div class="p-speed" role="group" aria-label="Speed"><button data-sp="1">1×</button><button data-sp="4" class="active">4×</button><button data-sp="12">12×</button></div>
      </div>
      <div class="p-summary" hidden></div>`;
    const q = s => el.querySelector(s);
    const diagram = q('.p-diagram');
    let run = null, i = 0, playing = false, speed = 4, acc = 0, last = 0, raf = 0, cfg = Object.assign({}, opts), lastEv = -1, caps = [1, 1, 1], pts = [];

    const defl = m => Math.pow(1 + cfg.inflation, (m + 1) / 12);
    const monthName = m => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + m + 1); return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }); };

    function load(r) {
      pause();
      run = r; i = 0; lastEv = -1;
      const M = run.months;
      caps = [0, 1, 2].map(k => Math.max(...M.map(mo => [mo.b1, mo.b2, mo.b3][k] / defl(mo.m)), 1) / 0.92);
      const view = [0, 1, 2].map(k => ({ k, name: ['Safety', 'Income', 'Growth'][k], amount: [M[0].b1, M[0].b2, M[0].b3][k] / defl(0) }));
      drawBuckets(diagram, view.map(v => Object.assign(v, { instruments: '', years: '', ret: 0 })), { compact: true, income: cfg.income });
      // mini chart
      const maxT = Math.max(...M.map(mo => mo.total / defl(mo.m)), 1);
      pts = M.map((mo, k) => [k / (M.length - 1) * 800, 86 - (mo.total / defl(mo.m)) / maxT * 78]);
      const line = 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L');
      q('.p-line').setAttribute('d', line);
      q('.p-ghost').setAttribute('d', line);
      q('.p-area').setAttribute('d', line + ` L800 90 L0 90 Z`);
      q('.p-slider').max = M.length - 1;
      q('.p-ticker').innerHTML = '<li class="p-hint">Press <b>Play</b> to watch your buckets month by month.</li>';
      q('.p-summary').hidden = true;
      render(false);
    }
    function render(animate) {
      if (!run) return;
      const mo = run.months[i];
      const d = defl(mo.m);
      const newEvents = [];
      if (animate) run.events.forEach((ev, k) => { if (k > lastEv && ev.m <= mo.m) { newEvents.push(ev); } });
      else lastEv = -1;
      run.events.forEach((ev, k) => { if (ev.m <= mo.m) lastEv = Math.max(lastEv, k); });
      setLevels(diagram, { b: [mo.b1 / d, mo.b2 / d, mo.b3 / d], caps, events: animate ? newEvents.slice(-3) : [], animate: false, showShare: true, paying: mo.short <= 1 });
      q('.p-age').textContent = `Age ${Math.floor(cfg.age + mo.m / 12)}`;
      q('.p-date').textContent = monthName(mo.m);
      q('.p-tot').textContent = F().short(mo.total / d);
      q('.p-slider').value = i;
      const x = pts[i] ? pts[i][0] : 0;
      q('.p-cliprect').setAttribute('width', x.toFixed(1));
      q('.p-dot').setAttribute('cx', x.toFixed(1)); q('.p-dot').setAttribute('cy', pts[i] ? pts[i][1].toFixed(1) : 0);
      if (animate && newEvents.length) newEvents.forEach(ev => addTick(ev, d));
      if (!animate) rebuildTicker();
    }
    function tickHTML(ev, d, isNew) {
      const t = RP.bucketEventText(ev);
      return `<li class="p-ev ${t.cls} ${isNew ? 'new' : ''}"><span class="p-ev-i">${t.icon}</span><div><b>Age ${Math.floor(cfg.age + ev.m / 12)} · ${esc(t.title)}</b>`
        + `<span>${ev.type === 'depleted' ? '' : F().short(ev.amount / d) + " (today's ₹) · "}${esc(t.why)}</span></div></li>`;
    }
    function addTick(ev, d) {
      const ul = q('.p-ticker');
      const hint = ul.querySelector('.p-hint'); if (hint) hint.remove();
      ul.insertAdjacentHTML('afterbegin', tickHTML(ev, d, true));
      while (ul.children.length > 5) ul.lastElementChild.remove();
    }
    function rebuildTicker() {
      const mo = run.months[i];
      const evs = run.events.filter(ev => ev.m <= mo.m).slice(-5).reverse();
      q('.p-ticker').innerHTML = evs.length ? evs.map(ev => tickHTML(ev, defl(ev.m), false)).join('') : '<li class="p-hint">Press <b>Play</b> to watch your buckets month by month.</li>';
    }
    function frame(t) {
      if (!playing) return;
      if (document.getElementById('tab-bucket').hidden || document.hidden) { pause(); return; }
      const dt = Math.min(0.1, (t - last) / 1000); last = t;
      acc += dt * speed * 6;               // 1× = 6 months a second
      let moved = false;
      while (acc >= 1 && i < run.months.length - 1) { acc -= 1; i++; moved = true; render(true); }
      if (i >= run.months.length - 1) { pause(); summary(); return; }
      if (moved) { /* rendered */ }
      raf = requestAnimationFrame(frame);
    }
    function play() {
      if (!run) return;
      if (i >= run.months.length - 1) { i = 0; render(false); q('.p-ticker').innerHTML = ''; }
      playing = true; last = performance.now(); acc = 0;
      q('.p-summary').hidden = true;
      q('.p-play').textContent = '❚❚ Pause'; q('.p-play').setAttribute('aria-label', 'Pause');
      raf = requestAnimationFrame(frame);
    }
    function pause() {
      playing = false; cancelAnimationFrame(raf);
      q('.p-play').textContent = '▶ Play'; q('.p-play').setAttribute('aria-label', 'Play');
    }
    function summary() {
      const F_ = F();
      const prot = run.events.filter(ev => ev.type === 'protect').length;
      const dips = run.events.filter(ev => ev.type === 'buydip').length;
      const end = run.months[run.months.length - 1];
      const ok = run.depletedAge == null;
      const el2 = q('.p-summary');
      el2.className = 'p-summary ' + (ok ? 'ok' : 'danger');
      el2.innerHTML = ok
        ? `<b>Money lasted to ${cfg.planUntil}.</b> Equity was left untouched in a falling market <b>${prot}</b> time${prot === 1 ? '' : 's'}, and Growth was topped up after a fall ${dips} time${dips === 1 ? '' : 's'}. You'd leave <b>${F_.short(end.total / defl(end.m))}</b> in today's money.`
        : `<b>Money ran out at age ${Math.floor(run.depletedAge)}.</b> Even with buckets, this market path was too harsh for this income. See "How to make this plan work".`;
      el2.hidden = false;
    }
    q('.p-play').addEventListener('click', () => (playing ? pause() : play()));
    q('.p-slider').addEventListener('input', e => { pause(); i = +e.target.value; render(false); });
    el.querySelectorAll('[data-sp]').forEach(b => b.addEventListener('click', () => {
      speed = +b.dataset.sp; el.querySelectorAll('[data-sp]').forEach(x => x.classList.toggle('active', x === b));
    }));
    return {
      load: r => load(r),
      configure: c => Object.assign(cfg, c),
      stop: pause,
      play,
    };
  }

  RP.bucketViz = { drawBuckets, setLevels, pulsePipe, countUp, gauge, heatmap, heatmapReveal, heatmapChoose, heatmapFocus, createPlayer };
})(window.RP);
