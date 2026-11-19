/* Simple planner: 5 questions → a full plan (hidden sensible defaults) → plain-language answer.
   Uses the same engine / Monte Carlo as the Extensive planner. */
window.RP = window.RP || {};
(function (RP) {
  'use strict';
  const num = v => (isFinite(parseFloat(v)) ? parseFloat(v) : 0);
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const SIMPLE_DEFAULTS = { currentAge: 35, retireAge: 60, savings: 1000000, monthlySaving: 25000, monthlyExpenses: 50000 };

  // Every hidden assumption lives here; the "Our assumptions" text is generated from it.
  const A = {
    planUntil: 90, inflation: 6, savingStepUp: 5,
    target: 0.8,          // "on track" = money lasts in at least 8 of 10 market scenarios
    runs: 300, seed: 42,  // same runs + seed for the verdict and the "how to fix" solvers, so they agree
    glideFloor: 30,
    mix: [
      { name: 'Equity mutual funds', cls: 'equity', pct: 50, ret: 11, sd: 18, fee: 0.5, taxType: 'equity', costBasisPct: 80, bucket: 3 },
      { name: 'Debt mutual funds', cls: 'debt', pct: 30, ret: 7, sd: 3, fee: 0.3, taxType: 'slabRedeem', costBasisPct: 90, bucket: 2 },
      { name: 'FD / liquid funds', cls: 'fixed', pct: 20, ret: 6.5, sd: 0, fee: 0, taxType: 'slabAccrual', costBasisPct: 100, bucket: 1 },
    ],
  };

  function assumptionText() {
    return [
      `Your money needs to last until age ${A.planUntil}.`,
      `All your expenses, including health costs, rise ${A.inflation}% a year.`,
      `Your monthly saving grows ${A.savingStepUp}% a year (in line with salary) until you retire, then stops.`,
      'Your savings are invested in a balanced mix: ' + A.mix.map(m => `${m.pct}% ${m.name.toLowerCase()} (about ${m.ret}% a year)`).join(', ')
        + `. The mix is rebalanced every year, and equity is reduced slowly after retirement (to no less than ${A.glideFloor}%).`,
      'Income tax is included, under the new tax regime (FY 2025-26 rules).',
      "Your expenses stay the same in today's money throughout retirement. Many people spend less in their 80s, so this is cautious.",
      'Not included: pension, rental income, inheritance, or big one-off costs such as a wedding or a house. Add these in the Extensive planner.',
      `"On track" means your money lasts to ${A.planUntil} in at least ${A.target * 10} of 10 simulated market scenarios (${A.runs} scenarios with good and bad years).`,
      "All amounts are in today's money.",
    ];
  }

  /** 5 answers → full plan object understood by RP.engine. */
  function toFullState(sm, opts = {}) {
    const s = RP.defaults();
    const exp = Math.max(0, num(sm.monthlyExpenses));
    const corpus = Math.max(0, num(sm.savings));
    s.profile = { currentAge: Math.round(num(sm.currentAge)), retireAge: Math.round(num(sm.retireAge)), planUntil: A.planUntil, useSpouse: false, spouseAge: 0, spousePlanUntil: 0, yearsOverride: 0 };
    s.allocMode = opts.forExtensive ? 'amounts' : 'percent';
    s.totalCorpus = corpus;
    s.assets = A.mix.map(m => ({ name: m.name, cls: m.cls, amount: Math.round(corpus * m.pct / 100), targetPct: m.pct, ret: m.ret, sd: m.sd, fee: m.fee, taxType: m.taxType, costBasisPct: m.costBasisPct, bucket: m.bucket, lockUntilAge: 0 }));
    s.spending = {
      monthly: exp, inflation: A.inflation,
      medicalMonthly: 0, medicalInflation: A.inflation,
      premiumAnnual: 0, premiumInflation: 12, phases: [],
    };
    s.presave = { sip: Math.max(0, num(sm.monthlySaving)), stepUp: A.savingStepUp };
    s.incomes = []; s.events = [];
    Object.assign(s.strategy, { order: 'taxefficient', rebalance: 'annual', glideEnabled: true, glideStep: 1, glideFloor: A.glideFloor, harvestLTCG: true, emergencyFund: 6 * exp, legacyToday: 0 });
    s.sim = { mode: 'mc', runs: opts.forExtensive ? 1000 : A.runs, seed: A.seed, corrEqDebt: 0.1, display: 'real' };
    return s;
  }

  /** → { field: message } (empty object = valid). Retiring at or before today's age means "already retired". */
  function validate(sm) {
    const e = {};
    const a = num(sm.currentAge), r = num(sm.retireAge);
    if (!(a >= 18 && a <= 85)) e.currentAge = 'Enter an age between 18 and 85.';
    if (!(r >= 30 && r < A.planUntil)) e.retireAge = `Enter an age between 30 and ${A.planUntil - 1}.`;
    if (num(sm.savings) < 0) e.savings = 'This cannot be negative.';
    if (num(sm.monthlySaving) < 0) e.monthlySaving = 'This cannot be negative.';
    if (!(num(sm.monthlyExpenses) > 0)) e.monthlyExpenses = 'Enter your monthly household expenses.';
    return e;
  }
  const isRetired = sm => num(sm.currentAge) >= num(sm.retireAge);

  // ---------- Monte Carlo based "how to get on track" solvers ----------
  function chance(sm, runs = A.runs) { return RP.montecarlo.run(toFullState(sm), { runs, seed: A.seed }).successRate; }
  const meets = (sm, runs) => chance(sm, runs) >= A.target;

  /** Smallest monthly saving that puts the plan on track. null if not reachable. */
  function requiredSaving(sm, runs) {
    const t = x => meets(Object.assign({}, sm, { monthlySaving: x }), runs);
    if (t(0)) return 0;
    let lo = 0, hi = Math.max(10000, num(sm.monthlySaving) * 2);
    while (!t(hi)) { lo = hi; hi *= 2; if (hi > 2e7) return null; }
    for (let k = 0; k < 30 && hi - lo > Math.max(500, hi * 0.01); k++) { const m = (lo + hi) / 2; if (t(m)) hi = m; else lo = m; }
    return Math.ceil(hi / 500) * 500;
  }
  /** Largest monthly expense (today's ₹) that keeps the plan on track. */
  function comfortableExpenses(sm, runs) {
    const t = x => meets(Object.assign({}, sm, { monthlyExpenses: x }), runs);
    if (!t(1000)) return 0;
    let lo = 1000, hi = Math.max(20000, num(sm.monthlyExpenses) * 2);
    while (t(hi)) { lo = hi; hi *= 2; if (hi > 1e8) return lo; }
    for (let k = 0; k < 30 && hi - lo > Math.max(500, lo * 0.01); k++) { const m = (lo + hi) / 2; if (t(m)) lo = m; else hi = m; }
    return Math.floor(lo / 500) * 500;
  }
  /** Smallest amount saved today (keeping the monthly saving as is) that puts the plan on track. null if not reachable. */
  function requiredStartSavings(sm, runs) {
    const t = x => meets(Object.assign({}, sm, { savings: x }), runs);
    if (t(0)) return 0;
    let lo = 0, hi = Math.max(1000000, num(sm.savings) * 2);
    while (!t(hi)) { lo = hi; hi *= 2; if (hi > 1e11) return null; }
    for (let k = 0; k < 30 && hi - lo > Math.max(10000, hi * 0.01); k++) { const m = (lo + hi) / 2; if (t(m)) hi = m; else lo = m; }
    return Math.ceil(hi / 10000) * 10000;
  }

  /** Earliest retirement age that puts the plan on track. null if none before planUntil − 1. */
  function earliestRetireAge(sm, runs) {
    const t = a => meets(Object.assign({}, sm, { retireAge: a }), runs);
    let lo = Math.max(Math.round(num(sm.currentAge)), Math.round(num(sm.retireAge))), hi = A.planUntil - 1;
    if (t(lo)) return lo;
    if (!t(hi)) return null;
    while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (t(m)) hi = m; else lo = m; }
    return hi;
  }

  // ---------- UI ----------
  let sm = null, timer = null, gen = 0, dirty = true, lastLevel = null, lastActions = '';
  const f = () => RP.fmt;
  const visible = () => !$('#tab-simple').hidden;

  function populate() {
    $$('[data-spath]').forEach(el => { if (document.activeElement !== el) el.value = sm[el.dataset.spath]; hint(el); });
    applyRetiredState();
  }
  function hint(el) {
    const h = el.closest('.s-field') && el.closest('.s-field').querySelector('.s-hint');
    if (h) h.textContent = num(el.value) > 0 ? f().short(num(el.value)) : '';
  }
  function applyRetiredState() {
    const ret = isRetired(sm);
    const el = $('[data-spath="monthlySaving"]');
    el.disabled = ret;
    $('#sSavingNote').hidden = !ret;
  }
  function showErrors(errs) {
    $$('[data-err]').forEach(el => { el.textContent = errs[el.dataset.err] || ''; });
    $$('[data-spath]').forEach(el => el.classList.toggle('invalid', !!errs[el.dataset.spath]));
  }

  function onInput(e) {
    const el = e.target;
    if (!el.dataset || !el.dataset.spath) return;
    sm[el.dataset.spath] = el.value === '' ? '' : num(el.value);
    hint(el);
    applyRetiredState();
    RP.state.saveSimple(sm);
    schedule();
  }
  function onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'btnToExtensive') copyToExtensive();
    else if (b.id === 'btnSimpleReset') {
      if (!confirm('Clear your answers and start over?')) return;
      sm = Object.assign({}, SIMPLE_DEFAULTS); RP.state.saveSimple(sm); populate(); compute();
    } else if (b.dataset.apply) {
      sm[b.dataset.apply] = num(b.dataset.value); RP.state.saveSimple(sm); populate(); compute();
      $('#sVerdict').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function schedule() {
    dirty = true;
    clearTimeout(timer);
    if (visible()) timer = setTimeout(compute, 250);
  }
  function ensureComputed() { if (dirty) compute(); }

  function compute() {
    dirty = false;
    const myGen = ++gen;
    const errs = validate(sm);
    showErrors(errs);
    $('#sResults').hidden = Object.keys(errs).length > 0;
    if (!$('#sResults').hidden) {
      try { render(myGen); } catch (err) { console.error(err); $('#sVerdict').className = 'verdict danger'; $('#sVerdict').textContent = 'Something went wrong: ' + err.message; }
    }
  }

  function render(myGen) {
    const F = f();
    const s = toFullState(sm);
    const det = RP.engine.run(s);
    const mc = RP.montecarlo.run(s, { runs: A.runs, seed: A.seed });
    const rate = mc.successRate;
    const inf = A.inflation / 100;
    const cur = Math.round(num(sm.currentAge)), ret = Math.max(Math.round(num(sm.retireAge)), cur);
    const retired = isRetired(sm);
    const onTrack = rate >= A.target;
    const level = onTrack ? 'ok' : rate >= 0.5 ? 'warn' : 'danger';
    // "7 in 10", but never claim 0 or 10 unless it really is none / all
    const tenths = rate > 0 && rate < 0.05 ? 'fewer than 1' : rate < 1 && rate >= 0.95 ? 'more than 9' : String(Math.round(rate * 10));
    const depAge = det.depletedAge, mcAge = mc.depletion.median;

    // Verdict
    let head, sub;
    if (level === 'ok') {
      head = `You're on track. Your money should last beyond age ${A.planUntil}.`;
      sub = `It lasts in ${tenths} out of 10 market scenarios, including many bad ones.`;
    } else if (level === 'warn') {
      head = depAge != null ? `Close, but not there yet. Your money lasts until about ${Math.floor(depAge)}.` : `Close, but not there yet. In weaker markets your money could run out around ${Math.floor(mcAge)}.`;
      sub = `Your money lasts to ${A.planUntil} in ${tenths} out of 10 market scenarios. Aim for 8 or more.`;
    } else {
      head = depAge != null ? `Not on track yet. Your money runs out at about ${Math.floor(depAge)}.` : `Risky. Your money runs out early in most market scenarios, typically around ${Math.floor(mcAge)}.`;
      sub = `Your money lasts to ${A.planUntil} in ${rate === 0 ? 'none' : tenths === 'fewer than 1' ? 'fewer than 1' : 'only ' + tenths} out of 10 market scenarios. See below for ways to fix this.`;
    }
    $('#sVerdict').className = 'verdict ' + level;
    $('#sVerdict').innerHTML = `<div class="v-icon">${level === 'ok' ? '✓' : '!'}</div><div><div class="v-head">${esc(head)}</div><div class="v-sub">${esc(sub)}</div></div>`;
    if (level !== lastLevel || RP.anim.entrance($('#sVerdict'))) RP.anim.replay($('#sVerdict'), 'anim-pop');
    lastLevel = level;

    // Cards
    const corpusRetReal = det.corpusAtRet != null ? det.corpusAtRet / Math.pow(1 + inf, ret - cur) : num(sm.savings);
    const cards = [
      [retired ? 'Your savings today' : `When you retire at ${ret}, you'll have`, F.short(corpusRetReal), "in today's money"],
      ['You can comfortably spend', '<span class="s-pending">Calculating…</span>', `today you spend ${F.short(num(sm.monthlyExpenses))} / month`],
      [`Chance your money lasts to ${A.planUntil}`, tenths === 'fewer than 1' ? '< 1 in 10' : tenths === 'more than 9' ? '> 9 in 10' : `${tenths} in 10`, `${F.pct(rate, 0)} of ${A.runs} market scenarios`],
    ];
    $('#sCards').innerHTML = cards.map((c, i) => `<div class="scard"><div class="sc-t">${esc(c[0])}</div><div class="sc-v" id="sCard${i}">${i === 1 ? c[1] : esc(c[1])}</div><div class="sc-s">${esc(c[2])}</div></div>`).join('');
    RP.anim.countUp($('#sCard0'), corpusRetReal, F.short, 'simple-corpus');
    if (RP.anim.entrance($('#sCards'))) RP.anim.stagger($('#sCards'), '.scard', 80);

    // Chart (today's money)
    const xs = [cur, ...det.rows.map(r => r.age + 1)];
    const vals = [num(sm.savings), ...det.rows.map(r => r.closing / Math.pow(1 + inf, r.y + 1))];
    RP.charts.stackedArea($('#sChart'), {
      xs, markerX: ret > cur ? ret : null, fmt: F.short,
      series: [{ name: 'Your savings (fixed average returns)', color: RP.THEME.primary, values: vals }],
      tip: k => chartTip(k, xs, vals, det, inf),
      animate: RP.anim.entrance($('#sChart')),
    });

    // Year-by-year (inside a collapsed <details>; values in today's money)
    renderYears(det, inf, ret);

    // Assumptions
    $('#sAssumptions').innerHTML = assumptionText().map(t => `<li>${esc(t)}</li>`).join('');

    // Slow part: Monte Carlo solvers run after paint so typing stays smooth.
    $('#sActions').innerHTML = onTrack ? '' : '<div class="panel s-actions"><h2>How to get on track</h2><p class="muted s-pending">Working out your options…</p></div>';
    setTimeout(() => {
      if (myGen !== gen) return;
      const comfy = comfortableExpenses(sm);
      if (myGen !== gen) return;
      const el = $('#sCard1');
      if (el) RP.anim.countUp(el, comfy, v => F.short(Math.round(v / 500) * 500) + ' / month', 'simple-comfy');
      if (onTrack) return;
      setTimeout(() => {
        if (myGen !== gen) return;
        const need = retired ? null : requiredSaving(sm);
        const start = requiredStartSavings(sm);
        const age = retired ? null : earliestRetireAge(sm);
        if (myGen !== gen) return;
        renderActions(need, age, comfy, retired, start);
      }, 0);
    }, 30);
  }

  function renderActions(need, age, comfy, retired, start) {
    const F = f();
    const items = [];
    const curSave = num(sm.monthlySaving);
    if (need != null && need > curSave) items.push({ text: `Save <b>${F.short(need - curSave)} more</b> every month (${F.short(need)} in total)`, field: 'monthlySaving', value: need });
    if (age != null && age > num(sm.retireAge)) items.push({ text: `Or retire at <b>${age}</b> instead of ${Math.round(num(sm.retireAge))}`, field: 'retireAge', value: age });
    if (start != null && start > num(sm.savings)) items.push({ text: `Or start with <b>${F.short(start)}</b> saved today (${F.short(start - num(sm.savings))} more than now), for example from a bonus, property sale or inheritance`, field: 'savings', value: start });
    if (comfy > 0 && comfy < num(sm.monthlyExpenses)) items.push({ text: `Or bring monthly expenses down to <b>${F.short(comfy)}</b>`, field: 'monthlyExpenses', value: comfy });
    let html = '<div class="panel s-actions"><h2>How to get on track</h2>';
    if (!items.length) {
      html += `<p>${retired ? 'Since you are already retired, the main levers are spending less or adding income (pension, rent, part-time work). Add these in the Extensive planner.' : "Even saving more won't close the gap on its own. Try retiring later and reducing expenses together."}</p>`;
    } else {
      html += '<p class="muted">Any one of these gets you to 8 in 10:</p><ul>' + items.map(it =>
        `<li><span>${it.text}</span><button class="s-try" data-apply="${it.field}" data-value="${it.value}">Try this</button></li>`).join('') + '</ul>';
    }
    $('#sActions').innerHTML = html + '</div>';
    const sig = items.map(it => it.field).join('|');
    if (sig !== lastActions) RP.anim.stagger($('#sActions'), 'li', 90);
    lastActions = sig;
  }

  /** Investment growth beyond inflation, in today's money, so each year adds up: start + save + growth − spent = end. */
  function realGrowth(r, inf) {
    const d0 = Math.pow(1 + inf, r.y), d1 = Math.pow(1 + inf, r.y + 1);
    return r.closing / d1 - (r.opening + r.contrib - r.withdrawn) / d0;
  }

  function renderYears(det, inf, ret) {
    const F = f();
    const rows = det.rows.map((r, i) => {
      const d0 = Math.pow(1 + inf, r.y), d1 = Math.pow(1 + inf, r.y + 1);
      const status = r.shortfall > 1 ? '<span class="chip danger">Money ran out</span>' : r.age === ret ? '<span class="chip ok">Retire</span>' : r.retired ? 'Retired' : 'Working';
      return `<tr class="${r.shortfall > 1 ? 'short' : ''} ${r.age === ret ? 'retire' : ''}">`
        + `<td data-tip="${i}:age">${r.age}</td><td data-tip="${i}:status">${status}</td><td data-tip="${i}:start">${F.short(r.opening / d0)}</td><td data-tip="${i}:save">${r.contrib > 0.5 ? F.short(r.contrib / d0) : '—'}</td>`
        + `<td data-tip="${i}:growth">${F.short(realGrowth(r, inf))}</td><td data-tip="${i}:spent">${r.withdrawn > 0.5 ? F.short(r.withdrawn / d0) : '—'}</td><td data-tip="${i}:end"><b>${F.short(r.closing / d1)}</b></td></tr>`;
    }).join('');
    const host = $('#sYears');
    host.dataset.tiphost = '1';
    host._cellTip = key => { const [i, col] = key.split(':'); return yearTip(det.rows[+i], col, det, inf, ret); };
    host.innerHTML = '<div class="tablewrap tall"><table class="data years"><thead><tr><th>Age</th><th>Status</th><th>Start of year</th><th>You save</th><th>Growth after inflation</th><th>Spent (incl. tax)</th><th>End of year</th></tr></thead><tbody>'
      + rows + '</tbody></table></div><p class="muted s-years-note">All amounts are in today\'s money. Start + save + growth − spent = end of year. Growth is what your investments earned beyond inflation, so it can be small or even negative.</p>';
  }

  /** Plain-language "how is this number calculated" popup for the Simple year table. */
  function yearTip(r, col, det, inf, ret) {
    if (!r) return null;
    const F = f(), I = F.inr, d = r.d;
    const p0 = Math.pow(1 + inf, r.y), p1 = Math.pow(1 + inf, r.y + 1);
    const pct = x => (Math.round(x * 1000) / 10) + '%';
    const rows = [], notes = [];
    const add = (label, value, cls) => rows.push({ label, value, cls });
    const line = () => rows.push(null);
    const start = r.opening / p0, save = r.contrib / p0, growth = realGrowth(r, inf), spent = r.withdrawn / p0, end = r.closing / p1;
    let title = '';
    const priceNote = `Prices at age ${r.age} are ${p0.toFixed(2)}× today's (${A.inflation}% a year for ${r.y} year${r.y === 1 ? '' : 's'}). Amounts are divided by this to show them in today's money.`;

    if (col === 'age' || col === 'status') {
      title = `Year ${r.y + 1} of your plan`;
      add('Age during the year', `${r.age} → ${r.age + 1}`);
      add('Status', r.shortfall > 1 ? 'Money ran out' : r.retired ? (r.age === ret ? 'First year of retirement' : 'Retired') : `Working: ${ret - r.age} year${ret - r.age === 1 ? '' : 's'} to retirement`);
      add('Prices compared to today', `${p0.toFixed(2)}×`);
      if (r.retired) notes.push('Retired: your expenses are paid from your savings, and nothing new is added.');
      else notes.push('Working: your salary pays your expenses and your monthly saving is added to your investments.');
      if (r.shortfall > 1) notes.push(`Your savings ran out this year. ${I(r.shortfall / p0)} of expenses (in today's money) could not be paid.`);
    } else if (col === 'start') {
      title = 'Start of year';
      if (r.y === 0) { add('Your savings today', I(start), 'total'); notes.push('This is what you entered as your savings so far.'); }
      else {
        add(`End of last year (age ${r.age - 1})`, I(start), 'total');
        notes.push("Each year starts where the previous one ended.");
      }
      d.openBal.forEach((b, k) => { if (b > 0.5) add(`  ${RP.simple.ASSUMPTIONS.mix[k].name}`, I(b / p0)); });
      if (r.y > 0) notes.push(priceNote);
    } else if (col === 'save') {
      title = 'You save';
      if (r.retired) notes.push('After retirement nothing new is added; your saving stops.');
      else {
        add('Your monthly saving today', I(d.sipBase));
        add(`× ${A.savingStepUp}% increase per year for ${r.y} yr`, `${Math.pow(1 + d.stepUp / 100, r.y).toFixed(3)}×`);
        add('= Monthly saving this year', I(d.sipM));
        add('× 12 months', I(d.sip));
        line();
        add("In today's money", `${I(d.sip)} ÷ ${p0.toFixed(2)} = ${I(save)}`, 'total');
        notes.push(`Your saving grows ${A.savingStepUp}% a year with your salary. Prices grow ${A.inflation}%, so in today's money it shrinks slightly each year.`);
        notes.push('New money is split 50% equity, 30% debt and 20% FD.');
      }
    } else if (col === 'growth') {
      title = 'Growth after inflation';
      d.openBal.forEach((b, k) => {
        if (b <= 0.5 && d.growthBy[k] === 0) return;
        add(`${RP.simple.ASSUMPTIONS.mix[k].name} @ ${pct(d.rates[k])}`, I(d.growthBy[k]));
      });
      add('Investments earned (future ₹)', I(r.growth), 'sub');
      add("Same in today's money", I(r.growth / p0));
      add(`− Lost to ${A.inflation}% price rise`, I(r.growth / p0 - growth));
      line();
      add('Growth after inflation', I(growth), 'total');
      notes.push('Rates are the expected return minus fund fees. They are earned on your balance as it changes through the year.');
      notes.push(`Rising prices reduce what your money can buy by about ${A.inflation}% a year. Growth after inflation is what is left over: the real increase in your spending power.`);
      if (growth < 0) notes.push('This is negative because your investments earned less than inflation this year.');
    } else if (col === 'spent') {
      title = 'Spent (incl. tax)';
      if (r.retired) {
        const expM = d.spendBase * Math.pow(1 + inf, r.y);
        add('Your monthly expenses today', I(d.spendBase));
        add(`× ${A.inflation}% price rise for ${r.y} yr`, `${p0.toFixed(2)}×`);
        add('= Monthly expenses this year', I(expM));
        add('× 12 months', I(expM * 12));
      } else notes.push('While you are working, your salary pays your expenses. Only tax on your investment income is paid from savings.');
      if (r.tax > 0.5) {
        const t = d.tax && d.tax.detail;
        add('+ Income tax', I(r.tax));
        if (t) {
          if (t.interest > 0.5) add('  taxable FD interest earned', I(t.interest));
          if (t.slabGains > 0.5) add('  taxable debt fund gains', I(t.slabGains));
          if (t.ltcgEq > 0.5) add('  equity gains on units sold', `${I(t.ltcgEq)} (first ${I(t.ltcgExempt)} tax-free)`);
        }
      }
      if (r.shortfall > 1) add('− Could not be paid (money ran out)', I(r.shortfall));
      add('= Taken from savings (future ₹)', I(r.withdrawn), 'sub');
      line();
      add("In today's money", `${I(r.withdrawn)} ÷ ${p0.toFixed(2)} = ${I(spent)}`, 'total');
      if (r.retired) notes.push(`In today's money your expenses stay at ${I(d.spendBase)} a month; only prices change.`);
      if (r.tax > 0.5) notes.push(r.retired ? 'Tax is under the new regime. Income up to ₹12 L is tax-free; equity gains above ₹1.25 L a year are taxed at 12.5%.' : `While working, investment income is taxed at your ${d.tax && d.tax.detail ? d.tax.detail.marginalRate : 30}% bracket.`);
      notes.push('Money is taken first from FDs, then debt funds, then equity, to keep tax low.');
    } else if (col === 'end') {
      title = 'End of year';
      add('Start of year', I(start));
      if (save > 0.5) add('+ You save', I(save));
      add('+ Growth after inflation', I(growth));
      if (spent > 0.5) add('− Spent (incl. tax)', I(spent));
      line();
      add(`End of year (age ${r.age + 1})`, I(end), 'total');
      notes.push(`In future rupees this is ${I(r.closing)}. In today's money it is ${I(r.closing)} ÷ ${p1.toFixed(2)} = ${I(end)}.`);
      notes.push('Each year the mix is rebalanced back to its target, and equity is reduced slowly after retirement. Moving money between funds does not change the total.');
    } else return null;

    return RP.ui.tipHTML({ title, chip: `Age ${r.age}`, rows, notes });
  }

  function chartTip(k, xs, vals, det, inf) {
    const F = f();
    if (k === 0) return RP.ui.tipHTML({ title: 'Your savings', chip: 'Today', rows: [{ label: 'Saved so far', value: F.inr(vals[0]), cls: 'total' }] });
    const r = det.rows[k - 1], d = Math.pow(1 + inf, r.y);
    const rows = [{ label: 'Start of year', value: F.inr(r.opening / d) }];
    if (r.contrib > 0.5) rows.push({ label: '+ You save', value: F.inr(r.contrib / d) });
    rows.push({ label: '+ Growth after inflation', value: F.inr(realGrowth(r, inf)) });
    if (r.withdrawn > 0.5) rows.push({ label: '− Spent (incl. tax)', value: F.inr(r.withdrawn / d) });
    rows.push(null, { label: `Savings at ${xs[k]}`, value: F.inr(vals[k]), cls: 'total' });
    const notes = [r.retired ? 'Retired: your expenses are paid from savings.' : 'Working: you add to your savings.'];
    if (r.shortfall > 1) notes.push(`Money ran out this year. ${F.inr(r.shortfall / d)} of expenses could not be paid.`);
    notes.push(`In today's money. Growth is what your investments earned beyond ${A.inflation}% inflation, so it can look small.`);
    return RP.ui.tipHTML({ title: 'Your savings', chip: `Age ${r.age}`, rows, notes });
  }

  function copyToExtensive() {
    if (Object.keys(validate(sm)).length) { alert('Please fix the highlighted answers first.'); return; }
    if (!confirm('This replaces the plan in the Extensive planner with these 5 answers and our assumptions. Continue?')) return;
    RP.app.replaceState(toFullState(sm, { forExtensive: true }));
    RP.app.showTab('extensive');
    window.scrollTo(0, 0);
  }

  function init() {
    sm = RP.state.loadSimple();
    populate();
    const root = $('#tab-simple');
    root.addEventListener('input', onInput);
    root.addEventListener('click', onClick);
  }

  RP.simple = {
    SIMPLE_DEFAULTS, ASSUMPTIONS: A, toFullState, validate, assumptionText,
    chance, requiredSaving, requiredStartSavings, comfortableExpenses, earliestRetireAge,
    init, compute, ensureComputed, schedule,
  };
})(window.RP);
