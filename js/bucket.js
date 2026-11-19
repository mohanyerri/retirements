/* 3-Bucket planner: required return, liability-matched bucket sizing, Monte Carlo optimiser,
   playback scenarios and the tab's UI orchestration. Drawing/animation lives in bucket-viz.js. */
window.RP = window.RP || {};
(function (RP) {
  'use strict';
  const num = v => (isFinite(parseFloat(v)) ? parseFloat(v) : 0);
  const clone = o => JSON.parse(JSON.stringify(o));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------------------------------------------------------------- defaults
  const BUCKET_DEFAULTS = {
    age: 60, planUntil: 90, corpus: 30000000, monthly: 100000, inflation: 6,
    risk: 'balanced', otherIncome: 0, otherGrowth: 0, legacy: 0,
    refillFreq: 'monthly', refillTrigger: 3, harvestBand: 20, runs: 250,
    b: [
      { name: 'Safety', ret: 6.5, sd: 0.5, fee: 0.1, instruments: 'Sweep-in FD, liquid fund, arbitrage fund, FD ladder' },
      { name: 'Income', ret: 7.75, sd: 3, fee: 0.3, instruments: 'SCSS, RBI floating-rate bonds, POMIS, short-duration & corporate bond funds, target-maturity funds' },
      { name: 'Growth', ret: 11, sd: 18, fee: 0.5, instruments: 'Nifty 50 / Next 50 index funds, flexi-cap, multi-asset funds' },
    ],
  };
  const RISK_LIMITS = {
    conservative: { min: 0.20, max: 0.40, label: 'Conservative' },
    balanced: { min: 0.35, max: 0.60, label: 'Balanced' },
    growth: { min: 0.50, max: 0.75, label: 'Growth' },
  };
  const N1S = [1, 1.5, 2, 2.5, 3, 4];
  const GAPS = [3, 4, 5, 6, 7, 8, 9, 10];
  const TARGET = 0.85;

  // ---------------------------------------------------------------- maths
  const months = b => Math.max(12, Math.round((num(b.planUntil) - num(b.age)) * 12));
  const mRate = bk => Math.pow(1 + (num(bk.ret) - num(bk.fee)) / 100, 1 / 12) - 1;

  /** Net monthly withdrawal for months 0..M-1 (nominal ₹, stepped up yearly). Negative = surplus. */
  function cashflows(b) {
    const M = months(b), inf = num(b.inflation) / 100, g = num(b.otherGrowth) / 100, out = new Array(M);
    for (let m = 0; m < M; m++) {
      const y = Math.floor(m / 12);
      out[m] = num(b.monthly) * Math.pow(1 + inf, y) - num(b.otherIncome) * Math.pow(1 + g, y);
    }
    return out;
  }

  /** Monthly return i such that PV(withdrawals) + PV(legacy) = corpus. Payments at month end. */
  function requiredReturn(b) {
    const W = cashflows(b), M = W.length, corpus = num(b.corpus);
    const legacyNom = num(b.legacy) * Math.pow(1 + num(b.inflation) / 100, M / 12);
    const pv = i => { let t = 0, d = 1; for (let m = 0; m < M; m++) { d /= 1 + i; t += W[m] * d; } return t + legacyNom * d; };
    const f = i => pv(i) - corpus;
    let lo = -0.01, hi = 0.03;
    if (f(lo) <= 0) return { monthly: lo, annual: Math.pow(1 + lo, 12) - 1, floor: true };
    if (f(hi) > 0) return { monthly: Infinity, annual: Infinity, impossible: true };
    for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; if (f(mid) > 0) lo = mid; else hi = mid; }
    const i = (lo + hi) / 2;
    return { monthly: i, annual: Math.pow(1 + i, 12) - 1 };
  }

  /** Liability-matched sizing: B1 funds years 1..N1, B2 years N1..N2 (PV at each bucket's own rate), B3 = rest. */
  function size(b, N1, N2) {
    const W = cashflows(b), M = W.length, corpus = num(b.corpus);
    const lim = RISK_LIMITS[b.risk] || RISK_LIMITS.balanced;
    const r1 = mRate(b.b[0]), r2 = mRate(b.b[1]);
    const m1 = Math.round(N1 * 12), m2 = Math.round(N2 * 12);
    const res = { N1, N2, B1: 0, B2: 0, B3: 0, shares: [0, 0, 0], valid: true, reason: '', inRange: true, capped: 0 };
    if (m2 > M) { res.valid = false; res.reason = 'Longer than your plan'; return res; }
    let d1 = 1, d2 = 1;
    for (let m = 0; m < m2; m++) {
      d1 /= 1 + r1; d2 /= 1 + r2;
      const w = Math.max(0, W[m]);
      if (m < m1) res.B1 += w * d1; else res.B2 += w * d2;
    }
    // At least a year of income in Safety even if other income covers spending (emergency reserve)
    res.B1 = Math.max(res.B1, num(b.monthly) * 12 * Math.min(1, N1));
    res.B3 = corpus - res.B1 - res.B2;
    if (res.B3 < 0) { res.valid = false; res.reason = 'Corpus too small to fund these years'; return res; }
    // Too much in equity for the chosen comfort level → park the excess in the Income bucket
    if (corpus > 0 && res.B3 / corpus > lim.max) { res.capped = res.B3 - lim.max * corpus; res.B2 += res.capped; res.B3 -= res.capped; }
    res.shares = corpus > 0 ? [res.B1 / corpus, res.B2 / corpus, res.B3 / corpus] : [0, 0, 0];
    res.inRange = res.shares[2] >= lim.min - 1e-9;
    res.expected = res.shares.reduce((t, sh, k) => t + sh * (num(b.b[k].ret) - num(b.b[k].fee)) / 100, 0);
    return res;
  }

  /** Full engine state for a bucket sizing. mode: 'bucket' | 'noBuckets' | 'balanced'. */
  function toState(b, sz, mode = 'bucket') {
    const s = RP.defaults();
    const age = Math.round(num(b.age));
    s.profile = { currentAge: age, retireAge: age, planUntil: Math.round(num(b.planUntil)), useSpouse: false, spouseAge: 0, spousePlanUntil: 0, yearsOverride: 0 };
    s.allocMode = 'amounts';
    const meta = [
      { cls: 'cash', taxType: 'slabAccrual' }, { cls: 'debt', taxType: 'slabRedeem' }, { cls: 'equity', taxType: 'equity' },
    ];
    let amts = [sz.B1, sz.B2, sz.B3];
    if (mode === 'balanced') { const c = num(b.corpus); amts = [0, c / 2, c / 2]; }
    s.assets = b.b.map((bk, k) => ({
      name: `${k + 1} · ${bk.name}`, cls: meta[k].cls, amount: Math.max(0, amts[k]), targetPct: 0,
      ret: num(bk.ret), sd: num(bk.sd), fee: num(bk.fee), taxType: meta[k].taxType, costBasisPct: 100, bucket: k + 1, lockUntilAge: 0,
    }));
    s.spending = { monthly: num(b.monthly), inflation: num(b.inflation), medicalMonthly: 0, medicalInflation: num(b.inflation), premiumAnnual: 0, premiumInflation: num(b.inflation), phases: [] };
    s.presave = { sip: 0, stepUp: 0 };
    s.incomes = num(b.otherIncome) > 0 ? [{ name: 'Pension / rent', monthly: num(b.otherIncome), startAge: age, endAge: 200, growth: num(b.otherGrowth), tax: 'pension' }] : [];
    s.events = [];
    Object.assign(s.strategy, {
      order: mode === 'bucket' ? 'bucket' : 'prorata', rebalance: mode === 'bucket' ? 'none' : 'annual',
      bucket1Years: sz.N1, bucket2Years: Math.max(0, sz.N2 - sz.N1) + (sz.capped > 0 ? sz.capped / Math.max(1, num(b.monthly) * 12) : 0),
      refillFreq: b.refillFreq, refillTrigger: num(b.refillTrigger), harvestBand: num(b.harvestBand) / 100,
      // keep Growth at its starting share of (Income + Growth): trim after rallies, buy after falls
      bucketRatio: sz.B2 + sz.B3 > 0 ? sz.B3 / (sz.B2 + sz.B3) : 0, bucketBand: num(b.harvestBand) / 100 / 4, bucketMinB2Years: 2,
      glideEnabled: false, harvestLTCG: true, emergencyFund: 0, legacyToday: num(b.legacy),
    });
    s.sim = { mode: 'mc', runs: num(b.runs) || 250, seed: 42, corrEqDebt: 0.1, display: 'real' };
    return s;
  }

  function score(b, sz, mode, runs) {
    const mc = RP.montecarlo.run(toState(b, sz, mode), { runs: runs || num(b.runs) || 250, seed: 42 });
    return { success: mc.successRate, median: mc.medianEndReal, depletion: mc.depletion };
  }

  function candidates(b) {
    const out = [];
    N1S.forEach((n1, r) => GAPS.forEach((gap, c) => out.push({ r, c, N1: n1, gap, sz: size(b, n1, n1 + gap) })));
    return out;
  }

  function pickBest(cells) {
    const ok = cells.filter(x => x.sz.valid && x.res);
    const pool = ok.some(x => x.sz.inRange) ? ok.filter(x => x.sz.inRange) : ok;
    if (!pool.length) return { best: null, runnerUp: null };
    const top = Math.max(...pool.map(x => x.res.success));
    const near = pool.filter(x => x.res.success >= top - 0.01).sort((a, b) => b.res.median - a.res.median);
    const best = near[0];
    const runnerUp = pool.filter(x => x !== best).sort((a, b) => (b.res.success - a.res.success) || (b.res.median - a.res.median))[0] || null;
    return { best, runnerUp };
  }

  /** Synchronous optimiser (used by tests). The UI uses optimiseAsync for the animated heatmap. */
  function optimise(b, runs) {
    const cells = candidates(b);
    cells.forEach(x => { if (x.sz.valid) x.res = score(b, x.sz, 'bucket', runs); });
    const pick = pickBest(cells);
    return Object.assign({ cells }, pick, pick.best ? baselines(b, pick.best.sz, runs) : {});
  }

  function baselines(b, sz, runs) {
    return { noBuckets: score(b, sz, 'noBuckets', runs), balanced: score(b, sz, 'balanced', runs) };
  }

  function optimiseAsync(b, onCell, onDone, isStale) {
    const cells = candidates(b);
    let k = 0;
    const step = () => {
      if (isStale()) return;
      const t0 = performance.now();
      while (k < cells.length && performance.now() - t0 < 40) {
        const x = cells[k++];
        if (x.sz.valid) x.res = score(b, x.sz, 'bucket');
        onCell(x, k, cells.length);
      }
      if (k < cells.length) setTimeout(step, 0);
      else setTimeout(() => {
        if (isStale()) return;
        const pick = pickBest(cells);
        onDone(Object.assign({ cells }, pick, pick.best ? baselines(b, pick.best.sz) : {}));
      }, 0);
    };
    setTimeout(step, 0);
  }

  /** Four replayable paths for the simulator: typical, bad early years, good, 2008-style crash. */
  function scenarios(b, sz) {
    const s = toState(b, sz);
    const mc = RP.montecarlo.run(s, { runs: num(b.runs) || 250, seed: 42, keepPaths: true });
    const P = Math.round(num(b.planUntil));
    const key = p => (p.depletedAge != null ? p.depletedAge - P - 1e6 : p.endReal);
    const sorted = mc.paths.slice().sort((x, y) => key(x) - key(y));
    const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
    const replay = p => RP.engine.run(s, { monthlyLog: true, returnsFn: (y, i) => p.matrix[y][i] });
    return {
      typical: { label: 'Typical markets', run: replay(at(0.5)) },
      bad: { label: 'Bad early years', run: replay(at(0.1)) },
      good: { label: 'Good markets', run: replay(at(0.9)) },
      crash: { label: '2008-style crash', run: RP.engine.run(s, { monthlyLog: true, shocks: [{ year: 1, cls: 'equity', ret: -0.45 }, { year: 2, cls: 'equity', ret: 0.30 }] }) },
    };
  }

  /** Fixes when the plan falls short: max sustainable income and extra corpus needed (at the best split). */
  function fixes(b, N1, N2) {
    const runs = 150;
    const meets = bb => { const sz = size(bb, N1, N2); return sz.valid && score(bb, sz, 'bucket', runs).success >= TARGET; };
    let lo = 0, hi = num(b.monthly);
    for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (meets(Object.assign({}, b, { monthly: m }))) lo = m; else hi = m; }
    const income = Math.floor(lo / 500) * 500;
    let clo = num(b.corpus), chi = num(b.corpus) * 2;
    let guard = 0;
    while (!meets(Object.assign({}, b, { corpus: chi })) && guard++ < 6) { clo = chi; chi *= 2; }
    for (let k = 0; k < 14; k++) { const m = (clo + chi) / 2; if (meets(Object.assign({}, b, { corpus: m }))) chi = m; else clo = m; }
    return { income, corpus: Math.ceil(chi / 50000) * 50000 };
  }

  function validate(b) {
    const e = {};
    if (!(num(b.age) >= 40 && num(b.age) <= 85)) e.age = 'Enter an age between 40 and 85.';
    if (!(num(b.planUntil) >= num(b.age) + 5 && num(b.planUntil) <= 105)) e.planUntil = 'Must be at least 5 years after your age (max 105).';
    if (!(num(b.corpus) > 0)) e.corpus = 'Enter your retirement corpus.';
    if (!(num(b.monthly) > 0)) e.monthly = 'Enter the monthly income you need.';
    return e;
  }

  // ---------------------------------------------------------------- UI
  let bs = null, timer = null, gen = 0, dirty = true, opt = null, current = null, player = null;
  const F = () => RP.fmt;
  const V = () => RP.bucketViz;
  const getP = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
  const setP = (o, p, v) => { const ks = p.split('.'); let x = o; for (let i = 0; i < ks.length - 1; i++) x = x[ks[i]]; x[ks[ks.length - 1]] = v; };
  const visible = () => !$('#tab-bucket').hidden;

  function populate() {
    $$('[data-bpath]').forEach(el => {
      const v = getP(bs, el.dataset.bpath);
      if (document.activeElement !== el) el.value = v == null ? '' : v;
      hint(el);
    });
    $$('.b-risk button').forEach(btn => btn.classList.toggle('active', btn.dataset.risk === bs.risk));
  }
  function hint(el) {
    const h = el.closest('.b-field') && el.closest('.b-field').querySelector('.s-hint');
    if (h) h.textContent = num(el.value) > 0 ? F().short(num(el.value)) : '';
  }
  function onInput(e) {
    const el = e.target;
    if (!el.dataset || !el.dataset.bpath) return;
    const v = el.type === 'number' ? (el.value === '' ? '' : num(el.value)) : el.value;
    setP(bs, el.dataset.bpath, v);
    hint(el);
    RP.state.saveBucket(bs);
    schedule();
  }
  function onClick(e) {
    const t = e.target.closest('button, td[data-cell]');
    if (!t) return;
    if (t.dataset.risk) { bs.risk = t.dataset.risk; RP.state.saveBucket(bs); populate(); compute(); }
    else if (t.id === 'bPrefill') prefillFromSimple();
    else if (t.id === 'bReset') { if (confirm('Reset the bucket planner to the example values?')) { bs = clone(BUCKET_DEFAULTS); RP.state.saveBucket(bs); populate(); compute(); } }
    else if (t.dataset.cell != null && opt) { const x = opt.cells[+t.dataset.cell]; if (x && x.sz.valid && x.res) select(x, x !== opt.best); }
    else if (t.id === 'bBackBest' && opt && opt.best) select(opt.best, false);
    else if (t.dataset.scn && player) { $$('.b-scn button').forEach(bn => bn.classList.toggle('active', bn === t)); player.load(current.scn[t.dataset.scn].run, t.dataset.scn); }
    else if (t.dataset.bapply) { setP(bs, t.dataset.bapply, num(t.dataset.value)); RP.state.saveBucket(bs); populate(); compute(); }
    else if (t.id === 'bShowAll') { const el = $('#bPlanAll'); el.hidden = !el.hidden; t.textContent = el.hidden ? 'Show the full plan (every year)' : 'Hide the full plan'; }
  }

  function prefillFromSimple() {
    if (!RP.simple) return;
    const sm = RP.state.loadSimple();
    const s = RP.simple.toFullState(sm);
    const det = RP.engine.run(s, { light: true });
    const cur = Math.round(num(sm.currentAge)), ret = Math.max(Math.round(num(sm.retireAge)), cur);
    const corpusToday = det.corpusAtRet != null ? det.corpusAtRet / Math.pow(1 + RP.simple.ASSUMPTIONS.inflation / 100, ret - cur) : num(sm.savings);
    Object.assign(bs, { age: ret, corpus: Math.round(corpusToday / 10000) * 10000, monthly: num(sm.monthlyExpenses), inflation: RP.simple.ASSUMPTIONS.inflation });
    RP.state.saveBucket(bs); populate(); compute();
    toast(ret > cur
      ? `Filled from your Simple plan: corpus of ${F().short(bs.corpus)} projected at age ${ret} (in today's money) and ${F().short(bs.monthly)}/month expenses.`
      : `Filled from your Simple plan: ${F().short(bs.corpus)} saved and ${F().short(bs.monthly)}/month expenses.`);
  }
  function toast(msg) {
    const t = $('#bToast');
    t.textContent = msg; t.hidden = false; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.classList.remove('show'); setTimeout(() => { t.hidden = true; }, 300); }, 5000);
  }

  function schedule() { dirty = true; clearTimeout(timer); if (visible()) timer = setTimeout(compute, 300); }
  function ensureComputed() { if (dirty) compute(); }

  function showErrors(errs) {
    $$('[data-berr]').forEach(el => { el.textContent = errs[el.dataset.berr] || ''; });
    $$('[data-bpath]').forEach(el => el.classList.toggle('invalid', !!errs[el.dataset.bpath]));
  }

  function compute() {
    dirty = false;
    const myGen = ++gen;
    const errs = validate(bs);
    showErrors(errs);
    const ok = !Object.keys(errs).length;
    $('#bResults').hidden = !ok;
    if (!ok) return;
    if (player) player.stop();
    opt = null;

    const rr = requiredReturn(bs);
    const preview = size(bs, 2, 8).valid ? size(bs, 2, 8) : size(bs, 1, 4);
    V().drawBuckets($('#bDiagram'), bucketView(preview), { income: num(bs.monthly), tip: k => bucketTip(preview, k) });
    V().gauge($('#bGauge'), rr.annual, preview.valid ? preview.expected : null);
    gaugeText(rr, preview.valid ? preview.expected : null);
    $('#bFixes').innerHTML = '';
    $('#bStatus').innerHTML = '';

    const cells = candidates(bs);
    const anyValid = cells.some(x => x.sz.valid);
    if (rr.impossible || !anyValid) {
      $('#bStatus').innerHTML = `<div class="verdict danger"><div class="v-icon">!</div><div><div class="v-head">This corpus cannot fund ${F().short(num(bs.monthly))}/month to age ${bs.planUntil}.</div><div class="v-sub">Even before market risk, the money needed for the spending is more than the corpus. See the fixes below.</div></div></div>`;
      V().heatmap($('#bHeat'), cells, { N1S, GAPS });
      $('#bProgress').style.width = '100%';
      renderFixesAsync(myGen, 2, 8);
      return;
    }

    V().heatmap($('#bHeat'), cells, { N1S, GAPS });
    $('#bOptState').textContent = 'Testing 48 bucket splits against 250 market scenarios each…';
    $('#bProgress').style.width = '0%';
    $('#bOptWrap').classList.add('running');
    optimiseAsync(bs, (x, k, n) => {
      if (myGen !== gen) return;
      V().heatmapReveal($('#bHeat'), x);
      $('#bProgress').style.width = (k / n * 100).toFixed(1) + '%';
    }, res => {
      if (myGen !== gen) return;
      opt = res;
      $('#bOptWrap').classList.remove('running');
      if (!res.best) { $('#bOptState').textContent = 'No workable split found.'; return; }
      V().heatmapChoose($('#bHeat'), res.best);
      $('#bOptState').textContent = 'Done. The ringed split is recommended: among the splits within 1 point of the best chance, it leaves you the most money.';
      select(res.best, false);
      if (res.best.res.success < TARGET) renderFixesAsync(myGen, res.best.N1, res.best.N1 + res.best.gap);
    }, () => myGen !== gen);
  }

  function bucketView(sz) {
    return [0, 1, 2].map(k => ({
      k, name: bs.b[k].name, amount: [sz.B1, sz.B2, sz.B3][k], share: sz.shares[k], ret: num(bs.b[k].ret),
      instruments: bs.b[k].instruments, years: yearsLabel(sz, k), ages: agesLabel(sz, k),
    }));
  }
  function yearsLabel(sz, k) {
    const a = num(bs.age);
    if (k === 0) return sz.N1 <= 1 ? 'Year 1' : `Years 1–${fmtY(sz.N1)}`;
    if (k === 1) return `Years ${fmtY(sz.N1 + (Number.isInteger(sz.N1) ? 1 : 0.5))}–${fmtY(sz.N2)}`;
    return `Year ${fmtY(Math.floor(sz.N2) + 1)} onwards · ages ${Math.round(a + sz.N2)}+`;
  }
  function agesLabel(sz, k) {
    const a = num(bs.age);
    if (k === 0) return `Ages ${a}–${Math.round(a + sz.N1)}`;
    if (k === 1) return `Ages ${Math.round(a + sz.N1)}–${Math.round(a + sz.N2)}`;
    return `Ages ${Math.round(a + sz.N2)}–${bs.planUntil}`;
  }
  const fmtY = y => (Number.isInteger(y) ? String(y) : y.toFixed(1));

  /** Hover popup on a bucket: how its size was worked out. */
  function bucketTip(sz, k) {
    const F_ = F(), bk = bs.b[k], amt = [sz.B1, sz.B2, sz.B3][k];
    const rate = (num(bk.ret) - num(bk.fee)) / 100;
    const W = cashflows(bs);
    const need0 = Math.max(0, W[0]);
    const rows = [{ label: 'Amount', value: `${F_.inr(amt)} · ${F_.pct(sz.shares[k], 0)}`, cls: 'total' }];
    const notes = [];
    if (k < 2) {
      const m0 = k === 0 ? 0 : Math.round(sz.N1 * 12), m1 = k === 0 ? Math.round(sz.N1 * 12) : Math.round(sz.N2 * 12);
      const raw = W.slice(m0, m1).reduce((t, w) => t + Math.max(0, w), 0);
      rows.unshift({ label: 'Funds', value: `${yearsLabel(sz, k)} (months ${m0 + 1}–${m1})` });
      rows.splice(1, 0,
        { label: 'Net income needed in those months', value: F_.inr(raw) },
        { label: `Discounted at ${F_.pct(rate, 2)} (its own return)`, value: `− ${F_.inr(raw - amt + (k === 1 ? sz.capped : 0))}` });
      if (k === 1 && sz.capped > 0) rows.splice(3, 0, { label: '+ Extra parked from Growth (above comfort)', value: F_.inr(sz.capped) });
      notes.push(`Liability matching: this bucket holds exactly the present value of the income it must pay. Your income starts at ${F_.short(need0)}/month${num(bs.otherIncome) > 0 ? ' after pension / rent' : ''} and rises ${bs.inflation}% a year.`);
    } else {
      rows.unshift({ label: 'Funds', value: yearsLabel(sz, k) });
      rows.splice(1, 0, { label: 'Corpus − Safety − Income', value: `${F_.short(num(bs.corpus))} − ${F_.short(sz.B1)} − ${F_.short(sz.B2)}` });
      notes.push(`Everything not needed for the next ${fmtY(sz.N2)} years goes into equity, which has the time to ride out crashes and beat inflation.`);
    }
    notes.push('Holds: ' + bk.instruments + '.');
    return RP.ui.tipHTML({ title: `${k + 1} · ${bk.name}`, chip: `${bk.ret}% a year`, rows, notes });
  }

  function gaugeText(rr, expected) {
    const F_ = F();
    let cls = 'ok', msg;
    if (rr.impossible) { cls = 'danger'; msg = 'No realistic return can fund this income from this corpus.'; }
    else if (rr.floor) { msg = `Your income is covered even with no growth at all. Buckets protect against inflation and give you a safety margin.`; }
    else {
      const margin = expected != null ? expected - rr.annual : null;
      cls = margin == null ? 'warn' : margin >= 0.01 ? 'ok' : margin >= 0 ? 'warn' : 'danger';
      msg = `You need <b>${F_.pct(rr.annual, 1)} a year</b> (${(rr.monthly * 100).toFixed(2)}% a month) to fund your income to age ${bs.planUntil}`
        + (num(bs.legacy) > 0 ? ` and leave ${F_.short(num(bs.legacy))}` : '') + '. '
        + (expected != null ? `Your buckets are expected to earn <b>${F_.pct(expected, 1)}</b> (after fees, before tax): a margin of <b>${margin >= 0 ? '+' : ''}${(margin * 100).toFixed(1)}%</b>.` : '');
    }
    const el = $('#bGaugeText');
    el.className = 'b-gauge-text ' + cls;
    el.innerHTML = msg;
  }

  /** Show a candidate everywhere: buckets, gauge, KPIs, simulator, chart and action plan. */
  function select(x, isPreview) {
    current = x;
    const sz = x.sz, F_ = F();
    $('#bPreviewNote').hidden = !isPreview;
    V().heatmapFocus($('#bHeat'), x);
    V().drawBuckets($('#bDiagram'), bucketView(sz), { income: num(bs.monthly), tip: k => bucketTip(sz, k) });
    const rr = requiredReturn(bs);
    V().gauge($('#bGauge'), rr.annual, sz.expected);
    gaugeText(rr, sz.expected);

    const s = toState(bs, sz);
    const det = RP.engine.run(s, { monthlyLog: true });
    const wr = (num(bs.monthly) - num(bs.otherIncome)) * 12 / num(bs.corpus);
    const endAge = Math.round(num(bs.planUntil));
    const kpis = [
      ['Chance your money lasts', x.res.success, v => F_.pct(v, 0), `${num(bs.runs) || 250} market scenarios`, x.res.success >= TARGET ? 'ok' : x.res.success >= 0.6 ? 'warn' : 'danger'],
      ['Money lasts until', det.depletedAge != null ? det.depletedAge : endAge, v => det.depletedAge != null ? 'Age ' + Math.floor(v) : `Age ${endAge}+`, 'with expected returns', det.depletedAge != null ? 'danger' : 'ok'],
      ['Median money left', x.res.median, v => F_.short(v), `at ${endAge}, in today's money`, ''],
      ['First-year withdrawal', wr, v => F_.pct(v, 1), 'guide: 3–4% for 30 years', wr > 0.045 ? 'danger' : wr > 0.035 ? 'warn' : 'ok'],
      ['Growth bucket (equity)', sz.shares[2], v => F_.pct(v, 0), `${RISK_LIMITS[bs.risk].label} range ${F_.pct(RISK_LIMITS[bs.risk].min, 0)}–${F_.pct(RISK_LIMITS[bs.risk].max, 0)}`, sz.inRange ? '' : 'warn'],
    ];
    $('#bKpis').innerHTML = kpis.map((k, i) => `<div class="card ${k[4]}"><div class="card-t">${esc(k[0])}</div><div class="card-v" id="bKpi${i}">—</div><div class="card-s">${esc(k[3])}</div></div>`).join('');
    kpis.forEach((k, i) => V().countUp($('#bKpi' + i), k[1], k[2]));

    // Why this split + baselines
    if (opt && opt.best) {
      const nb = opt.noBuckets, bl = opt.balanced;
      $('#bWhy').innerHTML = `<p><b>Why this split?</b> ${fmtY(sz.N1)} year${sz.N1 === 1 ? '' : 's'} of income in <b>Safety</b> means you can ride out a market fall of that length without selling equity. `
        + `<b>Income</b> covers the next ${fmtY(sz.N2 - sz.N1)} years with steady bonds and refills Safety when markets are down. `
        + `The remaining <b>${F_.pct(sz.shares[2], 0)}</b> in <b>Growth</b> has ${fmtY(sz.N2)}+ years to recover from any crash and keeps your income ahead of inflation.`
        + (sz.capped > 0 ? ` Your corpus is large, so ${F_.short(sz.capped)} above your equity comfort limit is parked in Income.` : '')
        + (!sz.inRange ? ' <span class="b-warn-text">Your corpus is tight, so equity is below your comfort range. More growth may be needed to beat inflation.</span>' : '') + '</p>'
        + `<div class="b-compare">${[['3 buckets (this plan)', x.res.success, true], ['Same mix, no buckets', nb.success], ['Single 50/50 balanced fund', bl.success]].map(r =>
          `<div class="b-cmp ${r[2] ? 'me' : ''}"><span>${r[0]}</span><div class="b-bar"><i style="width:${(r[1] * 100).toFixed(0)}%"></i></div><b>${F_.pct(r[1], 0)}</b></div>`).join('')}</div>`
        + (Math.max(nb.success, bl.success) > x.res.success + 0.02
          ? `<p class="b-honest"><b>An honest note:</b> in these simulations a simple rebalanced portfolio did a little better (${F_.pct(Math.max(nb.success, bl.success), 0)} vs ${F_.pct(x.res.success, 0)}). Buckets don't add return. Holding cash costs a little, and selling in lumps can raise your tax in some years. What they give you is a clear rule for where every month's income comes from, so you never have to sell equity in a crash. If you are sure you'd rebalance calmly through a 40% fall, the simpler portfolio is a fine choice. If not, buckets are worth this small cost.</p>`
          : `<p class="b-honest ok"><b>Good news:</b> the buckets do as well as, or better than, a simple rebalanced portfolio here, and they give you a clear rule for where every month's income comes from.</p>`)
        + (opt.runnerUp && !isPreview ? `<p class="muted b-runner">Runner-up: ${fmtY(opt.runnerUp.N1)} yrs Safety + ${fmtY(opt.runnerUp.gap)} yrs Income → ${F_.pct(opt.runnerUp.res.success, 0)} success, ${F_.short(opt.runnerUp.res.median)} median left.</p>` : '');
    }

    // Simulator (four scenarios), chart, plan
    const scn = scenarios(bs, sz);
    current.scn = scn;
    if (!player) player = V().createPlayer($('#bPlayer'), {});
    player.configure({ inflation: num(bs.inflation) / 100, age: num(bs.age), planUntil: endAge, income: num(bs.monthly) });
    $$('.b-scn button').forEach(bn => bn.classList.toggle('active', bn.dataset.scn === 'typical'));
    player.load(scn.typical.run, 'typical');

    renderChart(det);
    renderPlan(det, sz);
    renderRules(sz);
  }

  function renderChart(det) {
    const inf = num(bs.inflation) / 100;
    const xs = [det.startAge, ...det.rows.map(r => r.age + 1)];
    const names = bs.b.map((bk, k) => `${k + 1} · ${bk.name}`);
    const colors = [RP.THEME.saffron, RP.THEME.navy, RP.THEME.primary];
    const series = [0, 1, 2].map(k => ({ name: names[k], color: colors[k], values: [det.initialAmounts[k], ...det.rows.map(r => r.balances[k] / Math.pow(1 + inf, r.y + 1))] }));
    RP.charts.stackedArea($('#bChart'), {
      xs, fmt: F().short, series, animate: RP.anim.entrance($('#bChart')),
      tip: k => {
        const tot = series.reduce((t, s) => t + s.values[k], 0);
        return RP.ui.tipHTML({ title: 'Your buckets', chip: k === 0 ? 'Today' : `Age ${xs[k]}`,
          rows: [...series.map(s => ({ label: s.name, color: s.color, value: `${F().inr(s.values[k])} · ${tot > 0 ? F().pct(s.values[k] / tot, 0) : '—'}` })), null, { label: 'Total', value: F().inr(tot), cls: 'total' }],
          notes: ["Expected returns, in today's money. Safety is topped up from Growth after good markets and from Income after bad ones."] });
      },
    });
  }

  const BN = k => ['', 'Safety', 'Income', 'Growth'][k];
  function eventText(ev) {
    const mk = ev.marketRet != null ? `Growth ${ev.marketRet >= 0 ? '+' : ''}${(ev.marketRet * 100).toFixed(0)}% over 12 months` : '';
    if (ev.type === 'refill' && ev.from === 3) return { icon: '↗', cls: 'good', title: `Top up ${BN(ev.to)} from Growth`, why: `${mk}: sell equity while prices are up.` };
    if (ev.type === 'refill') return { icon: '→', cls: 'neutral', title: `Top up ${BN(ev.to)} from ${BN(ev.from)}`, why: ev.marketRet >= 0 ? 'Growth bucket is used up, so Income pays.' : mk };
    if (ev.type === 'protect') return { icon: '🛡', cls: 'protect', title: 'Top up Safety from Income', why: `${mk}: equity left untouched to recover.` };
    if (ev.type === 'harvest') return { icon: '✦', cls: 'good', title: 'Lock in gains: Growth → Income', why: 'Growth ran ahead of its target share.' };
    if (ev.type === 'depleted') return { icon: '!', cls: 'bad', title: 'Money ran out', why: 'Income could no longer be paid in full.' };
    return { icon: '·', cls: '', title: ev.type, why: '' };
  }
  RP.bucketEventText = eventText;

  const monthName = m => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + m + 1); return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }); };

  function renderPlan(det, sz) {
    const F_ = F();
    const evBy = {};
    det.events.forEach(ev => { (evBy[ev.m] = evBy[ev.m] || []).push(ev); });
    const rows = det.months.slice(0, 24).map(mo => {
      const evs = evBy[mo.m] || [];
      const act = evs.length ? evs.map(ev => { const t = eventText(ev); return `<span class="b-act ${t.cls}">${t.icon} ${esc(t.title)}: <b>${F_.short(ev.amount)}</b></span>`; }).join('') : '<span class="muted">No move needed</span>';
      return `<tr><td>${monthName(mo.m)}</td><td>${Math.floor(mo.age - 1 / 12)}</td><td>${F_.inr(mo.paid)}</td><td>${F_.short(mo.b1)}</td><td>${F_.short(mo.b2)}</td><td>${F_.short(mo.b3)}</td><td class="b-actcell">${act}</td></tr>`;
    }).join('');
    const yearly = det.rows.map(r => {
      const evs = det.events.filter(ev => Math.floor(ev.m / 12) === r.y);
      const sumT = (f) => evs.filter(f).reduce((t, ev) => t + ev.amount, 0);
      return `<tr><td>${r.age}</td><td>${F_.short(r.withdrawn - r.tax)}</td><td>${F_.short(r.tax)}</td><td>${F_.short(sumT(ev => ev.from === 3 && ev.to === 1))}</td><td>${F_.short(sumT(ev => ev.from === 2 && ev.to === 1))}</td><td>${F_.short(sumT(ev => ev.from === 3 && ev.to === 2))}</td>`
        + `<td>${F_.short(r.balances[0])}</td><td>${F_.short(r.balances[1])}</td><td>${F_.short(r.balances[2])}</td></tr>`;
    }).join('');
    $('#bPlan').innerHTML = `<div class="tablewrap"><table class="data b-plan"><thead><tr><th>Month</th><th>Age</th><th>Income paid from Safety</th><th>Safety</th><th>Income</th><th>Growth</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div>`
      + `<p class="muted b-note">Amounts are in actual (future) rupees with expected returns. Each month: pay income from Safety, then check whether Safety has dropped ${bs.refillTrigger} months below its target. Only then refill.</p>`
      + `<button id="bShowAll" class="add">Show the full plan (every year)</button>`
      + `<div id="bPlanAll" hidden><div class="tablewrap tall"><table class="data"><thead><tr><th>Age</th><th>Income paid</th><th>Tax</th><th>Growth → Safety</th><th>Income → Safety</th><th>Growth → Income</th><th>Safety at year end</th><th>Income at year end</th><th>Growth at year end</th></tr></thead><tbody>${yearly}</tbody></table></div></div>`;
  }

  function renderRules(sz) {
    const F_ = F();
    const need = num(bs.monthly) - num(bs.otherIncome);
    $('#bRules').innerHTML = `
      <div class="b-rules-grid">
        <div><h3>Every month</h3><ol>
          <li>Pay your ${F_.short(num(bs.monthly))} income from <b>Safety</b>${num(bs.otherIncome) > 0 ? ` (${F_.short(num(bs.otherIncome))} comes from pension / rent)` : ''}. A monthly sweep from a liquid fund to your bank account works well.</li>
          <li>If Safety has fallen more than <b>${bs.refillTrigger} months</b> (${F_.short(need * num(bs.refillTrigger))}) below its ${fmtY(sz.N1)}-year target, refill it to the full target.</li>
        </ol></div>
        <div><h3>Where the refill comes from</h3><ol>
          <li><b>Markets up</b> over the last 12 months → sell <b>Growth</b> (book gains while prices are high).</li>
          <li><b>Markets down</b> → sell <b>Income</b> and leave equity alone to recover. This is how buckets beat sequence-of-returns risk.</li>
          <li>In good markets, also top up <b>Income</b> to ${fmtY(sz.N2 - sz.N1)} years from Growth. If Growth is more than ${bs.harvestBand}% above its share, move the excess to Income.</li>
        </ol></div>
        <div><h3>Every April (yearly review)</h3><ul class="b-check">
          <li>Re-run this planner with your actual balances and spending.</li>
          <li>Sell equity units with up to ₹1.25 L of gains and buy them back: tax-free LTCG harvesting.</li>
          <li>Submit Form 15H / 15G to banks if your income is below the taxable limit, so no TDS is deducted on FD interest.</li>
          <li>Ladder SCSS / FDs so a slice matures every year. SCSS limit is ₹30 L per person, so a couple can hold ₹60 L.</li>
          <li>Check nominees on every account, and keep your spouse informed.</li>
        </ul></div>
      </div>`;
  }

  function renderFixesAsync(myGen, N1, N2) {
    $('#bFixes').innerHTML = '<div class="panel"><h2>How to make this plan work</h2><p class="muted">Working out your options…</p></div>';
    setTimeout(() => {
      if (myGen !== gen) return;
      const fx = fixes(bs, N1, N2);
      if (myGen !== gen) return;
      const F_ = F(), items = [];
      if (fx.income > 0 && fx.income < num(bs.monthly)) items.push([`Take <b>${F_.short(fx.income)}/month</b> instead of ${F_.short(num(bs.monthly))}`, 'monthly', fx.income]);
      if (fx.corpus > num(bs.corpus)) items.push([`Or start with a corpus of <b>${F_.short(fx.corpus)}</b> (${F_.short(fx.corpus - num(bs.corpus))} more)`, 'corpus', fx.corpus]);
      $('#bFixes').innerHTML = `<div class="panel s-actions"><h2>How to make this plan work</h2><p class="muted">Either of these gets you to an ${TARGET * 100}% chance of lasting to ${bs.planUntil}:</p><ul>`
        + items.map(it => `<li><span>${it[0]}</span><button class="s-try" data-bapply="${it[1]}" data-value="${it[2]}">Try this</button></li>`).join('') + '</ul>'
        + '<p class="muted b-note">Other levers: a part-time income, delaying a large expense, or an annuity for part of your core spending.</p></div>';
    }, 50);
  }

  function init() {
    bs = RP.state.loadBucket();
    populate();
    const root = $('#tab-bucket');
    root.addEventListener('input', onInput);
    root.addEventListener('click', onClick);
  }

  RP.bucket = {
    BUCKET_DEFAULTS, RISK_LIMITS, N1S, GAPS, TARGET,
    cashflows, requiredReturn, size, toState, score, optimise, scenarios, fixes, validate,
    init, compute, ensureComputed, schedule,
  };
})(window.RP);
