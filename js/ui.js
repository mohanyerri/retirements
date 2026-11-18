/* DOM: input binding, dynamic lists, results rendering, scenarios, export. */
window.RP = window.RP || {};
(function (RP) {
  'use strict';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = v => (isFinite(parseFloat(v)) ? parseFloat(v) : 0);
  const f = RP.fmt;
  let H = null;           // handlers from app
  let last = null;        // last results (for sorting / CSV)
  let sort = { col: 0, dir: 1 };

  const S = () => RP.app.state;
  function getPath(o, p) { return p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o); }
  function setPath(o, p, v) { const ks = p.split('.'); let x = o; for (let i = 0; i < ks.length - 1; i++) x = x[ks[i]]; x[ks[ks.length - 1]] = v; }
  function readInput(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number') { const v = parseFloat(el.value); return isFinite(v) ? v : 0; }
    return el.value;
  }
  function writeInput(el, v) {
    if (el.type === 'checkbox') el.checked = !!v;
    else if (document.activeElement !== el) el.value = v == null ? '' : v;
    updateHint(el);
  }
  function updateHint(el) {
    if (!el.classList.contains('money')) return;
    const h = el.parentElement && el.parentElement.querySelector('.hint');
    if (h) h.textContent = f.short(num(el.value));
  }
  function populate(root = document) { $$('[data-path]', root).forEach(el => writeInput(el, getPath(S(), el.dataset.path))); applyShow(); }
  function applyShow() {
    $$('[data-show]').forEach(el => {
      const [p, v] = el.dataset.show.split('=');
      el.hidden = String(getPath(S(), p)) !== v;
    });
  }

  // ---------- Dynamic lists ----------
  const opt = list => list.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  const LISTS = {
    assets: {
      path: 'assets', el: '#assetsList', noun: 'asset',
      cols: () => [
        { f: 'name', label: 'Name', type: 'text', w: 'w-name' },
        { f: 'cls', label: 'Class', type: 'select', options: RP.OPTIONS.cls },
        S().allocMode === 'percent'
          ? { f: 'targetPct', label: 'Alloc %', step: 1 }
          : { f: 'amount', label: 'Amount ₹', step: 10000, money: true, w: 'w-money' },
        { f: 'ret', label: 'Return %', step: 0.1, title: 'Expected long-run CAGR' },
        { f: 'sd', label: 'Volatility %', step: 0.5, title: 'Annual standard deviation (Monte Carlo)' },
        { f: 'fee', label: 'Fee %', step: 0.05, title: 'Expense ratio / advisory fee, deducted from return' },
        { f: 'taxType', label: 'Tax treatment', type: 'select', options: RP.OPTIONS.taxType },
        { f: 'costBasisPct', label: 'Cost %', step: 1, title: 'Share of current value that is your original investment (rest is unrealised gain)' },
        { f: 'bucket', label: 'Bucket', type: 'select', options: RP.OPTIONS.bucket },
        { f: 'lockUntilAge', label: 'Locked till', step: 1, title: 'Cannot withdraw or rebalance before this age (0 = liquid)' },
      ],
    },
    phases: {
      path: 'spending.phases', el: '#phasesList', noun: 'phase',
      cols: () => [{ f: 'fromAge', label: 'From age', step: 1 }, { f: 'pct', label: '% of living spend', step: 5 }],
    },
    incomes: {
      path: 'incomes', el: '#incomesList', noun: 'income',
      cols: () => [
        { f: 'name', label: 'Name', type: 'text', w: 'w-name' },
        { f: 'monthly', label: 'Monthly ₹ (today)', step: 1000, money: true, w: 'w-money' },
        { f: 'startAge', label: 'From age', step: 1 }, { f: 'endAge', label: 'Until age', step: 1 },
        { f: 'growth', label: 'Growth %/yr', step: 0.5 },
        { f: 'tax', label: 'Tax', type: 'select', options: RP.OPTIONS.incomeTax },
      ],
    },
    events: {
      path: 'events', el: '#eventsList', noun: 'goal / inflow',
      cols: () => [
        { f: 'name', label: 'Name', type: 'text', w: 'w-name' },
        { f: 'type', label: 'Type', type: 'select', options: RP.OPTIONS.eventType },
        { f: 'age', label: 'At age', step: 1 },
        { f: 'amount', label: 'Amount ₹ (today)', step: 10000, money: true, w: 'w-money' },
        { f: 'inflation', label: 'Inflation %', step: 0.5 },
        { f: 'repeatEvery', label: 'Repeat every (yrs)', step: 1 },
        { f: 'repeatUntil', label: 'Repeat until age', step: 1 },
      ],
    },
  };

  function field(c, path) {
    const t = c.title ? ` title="${esc(c.title)}"` : '';
    if (c.type === 'select') return `<select data-path="${path}"${t}>${opt(c.options)}</select>`;
    if (c.type === 'text') return `<input type="text" data-path="${path}" class="${c.w || ''}"${t}>`;
    return `<input type="number" data-path="${path}" step="${c.step || 'any'}" class="${c.money ? 'money ' : ''}${c.w || 'w-num'}"${t}>${c.money ? '<small class="hint"></small>' : ''}`;
  }
  function renderList(key) {
    const d = LISTS[key], root = $(d.el), items = getPath(S(), d.path) || [];
    const cols = d.cols();
    let h = '<div class="tablewrap"><table class="list"><thead><tr>' + cols.map(c => `<th${c.title ? ` title="${esc(c.title)}"` : ''}>${esc(c.label)}</th>`).join('') + '<th></th></tr></thead><tbody>';
    items.forEach((_, i) => {
      h += '<tr>' + cols.map(c => `<td>${field(c, `${d.path}.${i}.${c.f}`)}</td>`).join('')
        + `<td><button class="icon" data-remove="${key}" data-idx="${i}" title="Remove">✕</button></td></tr>`;
    });
    if (!items.length) h += `<tr><td colspan="${cols.length + 1}" class="muted">None yet.</td></tr>`;
    h += `</tbody></table></div><button class="add" data-add="${key}">+ Add ${d.noun}</button>`;
    root.innerHTML = h;
    populate(root);
  }
  const renderAllLists = () => Object.keys(LISTS).forEach(renderList);

  // ---------- Events ----------
  function onInput(e) {
    const el = e.target, p = el.dataset && el.dataset.path;
    if (!p) return;
    const v = readInput(el);
    setPath(S(), p, v);
    updateHint(el);
    $$(`[data-path="${p}"]`).forEach(o => { if (o !== el) writeInput(o, v); });
    if (p === 'allocMode') renderList('assets');
    applyShow();
    H.onChange();
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function onClick(e) {
    const t = e.target.closest('button, th[data-sort]');
    if (!t) return;
    const st = S();
    if (t.dataset.add) {
      const d = LISTS[t.dataset.add];
      getPath(st, d.path).push(RP.NEW_ITEMS[t.dataset.add]());
      renderList(t.dataset.add); H.onChange();
    } else if (t.dataset.remove) {
      const d = LISTS[t.dataset.remove];
      getPath(st, d.path).splice(+t.dataset.idx, 1);
      renderList(t.dataset.remove); H.onChange();
    } else if (t.dataset.sort != null) {
      const c = +t.dataset.sort;
      sort = { col: c, dir: sort.col === c ? -sort.dir : 1 };
      renderYearTable();
    } else if (t.dataset.loadScn != null) {
      const list = RP.state.loadScenarios();
      H.replaceState(RP.state.clone(list[+t.dataset.loadScn].state));
    } else if (t.dataset.delScn != null) {
      const list = RP.state.loadScenarios();
      if (confirm(`Delete scenario "${list[+t.dataset.delScn].name}"?`)) { list.splice(+t.dataset.delScn, 1); RP.state.saveScenarios(list); renderScenarios(); }
    } else if (t.id === 'btnSaveScenario') {
      const name = prompt('Name this scenario', `Plan ${new Date().toLocaleDateString('en-IN')}`);
      if (!name) return;
      const list = RP.state.loadScenarios();
      list.push({ name, savedAt: new Date().toISOString(), state: RP.state.clone(st) });
      RP.state.saveScenarios(list); renderScenarios();
    } else if (t.id === 'btnExportJson') {
      download('retirement-plan.json', JSON.stringify({ app: 'rp', version: 1, state: st, scenarios: RP.state.loadScenarios() }, null, 2), 'application/json');
    } else if (t.id === 'btnCsv') {
      download('retirement-projection.csv', toCSV(), 'text/csv');
    } else if (t.id === 'btnPrint') {
      $$('details').forEach(d => { d.dataset.wasOpen = d.open; });
      window.print();
    } else if (t.id === 'btnReset') {
      if (confirm('Reset all inputs to the example defaults? Saved scenarios are kept.')) H.replaceState(RP.defaults());
    }
  }

  function onImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        const st = data.state || data;
        if (!st.profile || !st.assets) throw new Error('This file does not look like a retirement plan.');
        if (Array.isArray(data.scenarios) && data.scenarios.length && confirm(`Also import ${data.scenarios.length} saved scenario(s)?`)) {
          RP.state.saveScenarios(RP.state.loadScenarios().concat(data.scenarios));
        }
        H.replaceState(st);
      } catch (err) { alert('Import failed: ' + err.message); }
      e.target.value = '';
    };
    r.readAsText(file);
  }

  // ---------- Results ----------
  const card = (title, value, sub, level) =>
    `<div class="card ${level || ''}"><div class="card-t">${esc(title)}</div><div class="card-v">${esc(value)}</div><div class="card-s">${esc(sub || '')}</div></div>`;

  function renderResults(R) {
    last = R;
    const { s, det, mc, solve } = R;
    const real = s.sim.display === 'real';
    const inf = det.inflation;
    const defl = yrs => (real ? Math.pow(1 + inf, yrs) : 1);
    const unit = real ? "today's ₹" : 'future ₹';
    const curAge = det.startAge, endAge = curAge + det.N, retAge = Math.max(Math.round(num(s.profile.retireAge)), curAge);
    const yrsToRet = retAge - curAge;

    $('#horizonInfo').textContent = `Projecting ${det.N} years: age ${curAge} → ${endAge}. Values in ${unit}.`;

    // Allocation summary
    const amts = det.initialAmounts, tot = det.initialTotal;
    const byCls = {};
    s.assets.forEach((a, i) => { byCls[a.cls] = (byCls[a.cls] || 0) + amts[i]; });
    $('#allocSummary').innerHTML = `<div class="allocbar">${s.assets.map((a, i) => tot > 0 && amts[i] > 0 ? `<span style="width:${amts[i] / tot * 100}%;background:${RP.COLORS[i % 8]}" title="${esc(a.name)}: ${f.pct(amts[i] / tot)}"></span>` : '').join('')}</div>`
      + `<div class="muted">Total ${f.inr(tot)} (${f.short(tot)}) · ` + RP.OPTIONS.cls.filter(([c]) => byCls[c] > 0).map(([c, l]) => `${l} ${f.pct(byCls[c] / tot, 0)}`).join(' · ') + '</div>';

    // Cards
    const gap = solve.sustainable - num(s.spending.monthly);
    const cards = [
      card('Corpus at retirement', det.corpusAtRet != null ? f.short(det.corpusAtRet / defl(yrsToRet)) : '—', `age ${retAge} · ${unit}`),
      det.depletedAge != null
        ? card('Money lasts until', 'Age ' + f.age(det.depletedAge), `${(endAge - det.depletedAge).toFixed(1)} yrs short of age ${endAge}`, 'danger')
        : card('Money lasts until', `Age ${endAge}+`, 'the full plan horizon', 'ok'),
      mc ? card('Probability of success', f.pct(mc.successRate, 0), `${mc.runs} market paths`, mc.successRate >= 0.85 ? 'ok' : mc.successRate >= 0.7 ? 'warn' : 'danger') : '',
      card('Sustainable living spend', f.short(solve.sustainable) + ' / mo', `today's ₹ · ${gap >= 0 ? 'room of ' + f.short(gap) : 'cut ' + f.short(-gap)} vs your ${f.short(num(s.spending.monthly))}`, gap >= 0 ? 'ok' : 'danger'),
      card('Corpus needed today', solve.requiredCorpus == null ? 'Not reachable' : f.short(solve.requiredCorpus),
        solve.requiredCorpus == null ? '' : (solve.requiredCorpus > det.initialTotal ? `shortfall ${f.short(solve.requiredCorpus - det.initialTotal)}` : `surplus ${f.short(det.initialTotal - solve.requiredCorpus)}`),
        solve.requiredCorpus != null && solve.requiredCorpus <= det.initialTotal ? 'ok' : 'warn'),
      card('First-year withdrawal rate', f.pct(det.firstYearWR), `sustainable ≈ ${f.pct(solve.swr)} · guide 3–3.5%`, det.firstYearWR == null ? '' : det.firstYearWR > 0.045 ? 'danger' : det.firstYearWR > 0.035 ? 'warn' : 'ok'),
      card('Earliest retirement age', solve.earliestRetireAge == null ? 'Not in horizon' : String(solve.earliestRetireAge), 'at today\'s spending'),
      card('Corpus at end of plan', f.short(det.endBal / defl(det.N)), `age ${endAge} · ${unit}`),
      card('Lifetime tax', f.short(det.totalTax), 'sum of nominal ₹'),
    ];
    $('#cards').innerHTML = cards.join('');
    $('#modeNote').textContent = mc ? '' : 'Switch the simulation to Monte Carlo (section 9) to see the probability of success and range of outcomes.';

    // Warnings
    $('#warnings').innerHTML = R.warnings.map(w => `<li class="${w.level}">${esc(w.text)}</li>`).join('');

    // Charts
    const xs = [curAge, ...det.rows.map(r => r.age + 1)];
    const areaSeries = s.assets.map((a, i) => ({ name: a.name, color: RP.COLORS[i % 8], values: [amts[i], ...det.rows.map(r => r.balances[i] / defl(r.y + 1))] }));
    RP.charts.stackedArea($('#chartArea'), { xs, markerX: retAge, fmt: f.short, series: areaSeries, tip: k => areaTip(k, xs, areaSeries) });
    $('#fanPanel').hidden = !mc;
    if (mc) {
      const b = k => [tot, ...mc.bands[k].map((v, y) => v / defl(y + 1))];
      const bands = { p10: b('p10'), p25: b('p25'), p50: b('p50'), p75: b('p75'), p90: b('p90') };
      const fixedLine = [tot, ...det.rows.map(r => r.closing / defl(r.y + 1))];
      RP.charts.fan($('#chartFan'), Object.assign({ xs, markerX: retAge, fmt: f.short, line: fixedLine, tip: k => fanTip(k, xs, bands, fixedLine) }, bands));
    }
    const fr = det.rows.filter(r => r.retired || r.goals > 0 || r.tax > 0);
    const barSeries = [
        { name: 'Living', color: '#2563eb', values: fr.map(r => r.spend / defl(r.y)) },
        { name: 'Medical + insurance', color: '#dc2626', values: fr.map(r => r.medical / defl(r.y)) },
        { name: 'Goals', color: '#f59e0b', values: fr.map(r => r.goals / defl(r.y)) },
        { name: 'Tax', color: '#64748b', values: fr.map(r => r.tax / defl(r.y)) },
    ];
    const incLine = { name: 'Other income', color: '#16a34a', values: fr.map(r => r.income / defl(r.y)) };
    RP.charts.stackedBars($('#chartBars'), { xs: fr.map(r => r.age), markerX: retAge, fmt: f.short, series: barSeries, line: incLine, tip: k => barsTip(k, fr, barSeries, incLine) });

    // Stress tests
    $('#stress').innerHTML = '<table class="data"><thead><tr><th>Scenario</th><th>Money lasts until</th><th>End corpus (today\'s ₹)</th><th></th></tr></thead><tbody>'
      + R.stress.map(x => `<tr><td>${esc(x.name)}</td><td>${x.depletedAge != null ? 'Age ' + f.age(x.depletedAge) : 'Age ' + x.endAge + '+'}</td><td>${f.short(x.endReal)}</td><td><span class="chip ${x.success ? 'ok' : 'danger'}">${x.success ? 'Survives' : 'Fails'}</span></td></tr>`).join('')
      + '</tbody></table>';

    renderYearTable();
    renderScenarios();
  }

  function yearCols() {
    const { s, det } = last;
    const real = s.sim.display === 'real';
    const d0 = r => (real ? Math.pow(1 + det.inflation, r.y) : 1), d1 = r => (real ? Math.pow(1 + det.inflation, r.y + 1) : 1);
    // [label, getter (display units), isRaw, explain key, value is end-of-year]
    return [
      ['Age', r => r.age, true, 'age'],
      ['Opening', r => r.opening / d0(r), false, 'opening'],
      ['Savings & inflows', r => r.contrib / d0(r), false, 'contrib'],
      ['Other income', r => r.income / d0(r), false, 'income'],
      ['Living', r => r.spend / d0(r), false, 'spend'],
      ['Medical + insurance', r => r.medical / d0(r), false, 'medical'],
      ['Goals', r => r.goals / d0(r), false, 'goals'],
      ['Returns', r => r.growth / d0(r), false, 'growth'],
      ['Tax', r => r.tax / d0(r), false, 'tax'],
      ['Shortfall', r => r.shortfall / d0(r), false, 'shortfall'],
      ['Closing', r => r.closing / d1(r), false, 'closing', true],
      ...s.assets.map((a, i) => [a.name, r => r.balances[i] / d1(r), false, 'asset:' + i, true]),
    ];
  }
  function renderYearTable() {
    if (!last) return;
    const cols = yearCols();
    const rows = last.det.rows.slice();
    const g = cols[sort.col] ? cols[sort.col][1] : cols[0][1];
    rows.sort((a, b) => (g(a) - g(b)) * sort.dir);
    const retAge = Math.round(num(last.s.profile.retireAge));
    $('#yearTable').innerHTML = '<table class="data years"><thead><tr>'
      + cols.map((c, i) => `<th data-sort="${i}" class="${sort.col === i ? 'sorted' : ''}">${esc(c[0])}${sort.col === i ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')
      + '</tr></thead><tbody>'
      + rows.map(r => `<tr class="${r.shortfall > 1 ? 'short' : ''} ${r.age === retAge ? 'retire' : ''}">`
        + cols.map((c, ci) => `<td data-y="${r.y}" data-c="${ci}">${c[2] ? c[1](r) : f.short(c[1](r))}</td>`).join('') + '</tr>').join('')
      + '</tbody></table>';
  }
  // ---------- Shared popup renderer ----------
  // o = { title, chip, lead, rows: [ {label, value, color, cls} | null (separator) ], notes: [] }
  function tipHTML(o) {
    return `<div class="tip-h"><span class="tip-t">${esc(o.title)}</span>${o.chip ? `<span class="tip-chip">${esc(o.chip)}</span>` : ''}</div>`
      + (o.lead ? `<div class="tip-lead">${esc(o.lead)}</div>` : '')
      + '<div class="tip-rows">' + (o.rows || []).map(x => x == null ? '<div class="tip-sep"></div>'
        : `<div class="tip-row ${x.cls || ''}"><span class="tip-l">${x.color ? `<i style="background:${x.color}"></i>` : ''}${esc(x.label)}</span><span class="tip-v">${esc(x.value)}</span></div>`).join('') + '</div>'
      + (o.notes && o.notes.length ? '<div class="tip-notes">' + o.notes.map(n => `<p>${esc(n)}</p>`).join('') + '</div>' : '');
  }

  // ---------- "How is this calculated?" popup for the year table ----------
  function explain(col, r) {
    const { s } = last;
    const d = r.d, I = f.inr;
    const P = x => (Math.round(x * 10000) / 100) + '%';
    const pw = (rate, n) => Math.pow(1 + rate, n);
    const L = [], notes = [];
    const add = (label, value, cls) => L.push([label, value, cls || '']);
    const sep = () => L.push(null);
    const key = col[3];
    let title = col[0], nominal = null;
    const ageNote = `Age ${r.age} (plan year ${r.y + 1}). Inflation is applied ${r.y} time${r.y === 1 ? '' : 's'} since today.`;

    if (key === 'age') {
      title = `Plan year ${r.y + 1}`;
      add('Age during the year', `${r.age} → ${r.age + 1}`);
      add('Status', r.retired ? (r.age === d.retAge ? 'First year of retirement' : 'Retired') : `Working: ${d.retAge - r.age} yr(s) to retirement`);
      add('Price level vs today', `(1 + ${P(d.inf)})^${r.y} = ${pw(d.inf, r.y).toFixed(3)}×`);
    } else if (key === 'opening') {
      notes.push(r.y === 0 ? 'Your corpus today.' : `Same as the closing balance at the end of the previous year (age ${r.age - 1}).`);
      s.assets.forEach((a, i) => add(a.name, I(d.openBal[i])));
      sep(); add('Opening balance', I(r.opening), 'total'); nominal = r.opening;
    } else if (key === 'contrib') {
      if (d.sip > 0) {
        add('Monthly SIP', `${I(d.sipBase)} × (1 + ${d.stepUp}%)^${r.y} = ${I(d.sipM)}`);
        add('SIP for the year', `${I(d.sipM)} × 12 = ${I(d.sip)}`);
      } else notes.push(r.retired ? 'There is no SIP after retirement.' : 'No SIP is set.');
      d.evItems.filter(e => e.type === 'inflow').forEach(e => add(e.name, `${I(e.today)} × (1 + ${e.infl}%)^${r.y} = ${I(e.amount)}`));
      sep(); add('Savings & inflows', I(r.contrib), 'total'); nominal = r.contrib;
      notes.push('New money is split across assets by your target allocation.');
    } else if (key === 'income') {
      if (!d.incItems.length) notes.push('No other income is active at this age.');
      d.incItems.forEach(it => add(it.name, `${I(it.today)} × (1 + ${it.growth}%)^${r.y} = ${I(it.monthly)}/mo × 12 = ${I(it.monthly * 12)}`));
      sep(); add('Other income', I(r.income), 'total'); nominal = r.income;
      if (d.incItems.length) notes.push('Income is used for spending first, so only the gap is withdrawn from the corpus. Any surplus is reinvested.');
    } else if (key === 'spend') {
      if (!r.retired) notes.push(`Living expenses are drawn from the corpus only from retirement (age ${d.retAge}). Until then your salary pays for them.`);
      else {
        const F = pw(d.inf, r.y);
        add("Today's monthly spend", I(d.spendBase));
        add(`× inflation (1 + ${P(d.inf)})^${r.y}`, F.toFixed(4));
        add('× spending phase', P(d.phase));
        add('= monthly spend', I(d.spendBase * F * d.phase));
        sep(); add('× 12 months', I(r.spend), 'total');
        notes.push(ageNote);
      }
      nominal = r.spend;
    } else if (key === 'medical') {
      if (!r.retired) notes.push(`Medical costs and the premium are drawn from the corpus only from retirement (age ${d.retAge}).`);
      else {
        const mF = pw(d.medInf, r.y), pF = pw(d.premInf, r.y);
        add('Medical out-of-pocket', `${I(d.medBase)} × (1 + ${P(d.medInf)})^${r.y} = ${I(d.medBase * mF)}/mo`);
        add('  × 12', I(d.medBase * mF * 12));
        add('Health premium', `${I(d.premBase)} × (1 + ${P(d.premInf)})^${r.y}`);
        add('  = per year', I(d.premBase * pF));
        sep(); add('Medical + insurance', I(r.medical), 'total');
      }
      nominal = r.medical;
    } else if (key === 'goals') {
      const ex = d.evItems.filter(e => e.type !== 'inflow');
      if (!ex.length) notes.push('No goals fall due at this age.');
      ex.forEach(e => add(e.name, `${I(e.today)} × (1 + ${e.infl}%)^${r.y} = ${I(e.amount)}`));
      if (ex.length) { sep(); add('Goals', I(r.goals), 'total'); notes.push('Paid from the corpus at the start of the year.'); }
      nominal = r.goals;
    } else if (key === 'growth') {
      s.assets.forEach((a, i) => {
        if (d.openBal[i] <= 0 && d.growthBy[i] === 0) return;
        add(`${a.name} @ ${P(d.rates[i])}`, I(d.growthBy[i]));
      });
      sep(); add('Returns', I(r.growth), 'total'); nominal = r.growth;
      notes.push('Rate = expected return − fee, compounded monthly. The return is earned on the balance as it changes through the year (SIPs in, withdrawals out), so it is not exactly opening balance × rate.');
      if (s.sim.mode === 'mc') notes.push('This table uses the fixed expected returns, not the Monte Carlo paths.');
    } else if (key === 'tax') {
      nominal = r.tax;
      if (!d.taxOn) notes.push('Tax is turned off (section 8).');
      else {
        const t = d.tax.detail, cess = 1 + t.cessPct / 100;
        const items = [['FD / accrual interest', t.interest], ['Debt fund gains realised', t.slabGains], ['Pension / annuity', t.pension], ['Other taxable income', t.otherSlab]];
        items.forEach(([l, v]) => { if (v > 0.5) add(l, I(v)); });
        if (t.rentGross > 0) add('Rent × 70% (30% deduction)', `${I(t.rentGross)} × 70% = ${I(t.rent)}`);
        if (t.regime === 'working') {
          sep(); add('Income taxed at your marginal rate', `${I(t.income)} × ${t.marginalRate}% = ${I(t.slabBeforeCess)}`);
          notes.push('Before retirement, portfolio income stacks on top of your salary, so it is taxed at your marginal rate.');
        } else {
          if (t.std > 0) add('− Standard deduction', I(t.std));
          if (t.deductions > 0) add('− Deductions (80TTB, 80C/80D…)', I(t.deductions));
          add(`Taxable income (${t.regime} regime)`, I(t.income), 'sub');
          add('Slab tax', I(t.slabBeforeCess + t.rebate));
          if (t.rebate > 0) add('− 87A rebate / marginal relief', I(t.rebate));
        }
        if (t.ltcgEq > 0.5) add('Equity LTCG', `(${I(t.ltcgEq)} − ${I(t.ltcgExempt)} exempt) × ${t.ltcgRate}% = ${I(t.ltcgEqTax)}`);
        if (t.ltcgOther > 0.5) add('Other LTCG', `${I(t.ltcgOther)} × ${t.ltcgOtherRate}% = ${I(t.ltcgOtherTax)}`);
        const pre = t.slabBeforeCess + t.ltcgEqTax + t.ltcgOtherTax;
        add(`+ Cess ${t.cessPct}%`, `${I(pre)} × ${cess} = ${I(pre * cess)}`);
        sep(); add('Tax for the year', I(r.tax), 'total');
        notes.push('Gains count only when you sell (withdrawals, rebalancing). Only the gain part of a sale is taxed, not the whole amount. The tax is paid from the corpus at year end.');
      }
    } else if (key === 'shortfall') {
      nominal = r.shortfall;
      if (r.shortfall <= 1) notes.push('No shortfall: the corpus covered every outflow this year.');
      else {
        add('Spending + medical needed', I(d.needM * 12));
        add('− Other income', I(d.incM * 12));
        add('+ Goals', I(r.goals));
        add('+ Tax', I(r.tax));
        add('− Actually withdrawn', I(r.withdrawn));
        sep(); add('Unfunded', I(r.shortfall), 'total');
        notes.push('The corpus ran out, so these expenses could not be paid.');
      }
    } else if (key === 'closing') {
      add('Opening balance', I(r.opening));
      add('+ Savings & inflows', I(r.contrib));
      if (d.surplus > 0.5) add('+ Surplus income reinvested', I(d.surplus));
      add('+ Returns', I(r.growth));
      add('− Withdrawn for spending', I(d.spendW));
      if (d.goalW > 0.5) add('− Withdrawn for goals', I(d.goalW));
      if (d.taxW > 0.5) add('− Withdrawn for tax', I(d.taxW));
      sep(); add('Closing balance', I(r.closing), 'total'); nominal = r.closing;
      notes.push('Moves between assets (rebalancing, bucket refills) do not change the total.');
    } else if (key.startsWith('asset:')) {
      const i = +key.slice(6), a = s.assets[i];
      title = a.name;
      add('Opening', I(d.openBal[i]));
      add(`+ Returns @ ${P(d.rates[i])} (net of fee)`, I(d.growthBy[i]));
      add('+ Bought (SIP, inflows, rebalance)', I(d.bought[i]));
      add('− Sold (withdrawals, tax, rebalance)', I(d.sold[i]));
      sep(); add('Closing', I(r.balances[i]), 'total'); nominal = r.balances[i];
      const ord = { taxefficient: 'tax-efficient order (FD → debt → gold → equity → tax-free)', bucket: `bucket ${a.bucket} of the bucket strategy`, prorata: 'pro-rata across all assets' }[d.order];
      notes.push(`Withdrawals follow the ${ord}.` + (num(a.lockUntilAge) > r.age ? ` Locked until age ${a.lockUntilAge}: no withdrawals or rebalancing.` : ''));
    }

    if (nominal != null && s.sim.display === 'real') {
      const n = r.y + (col[4] ? 1 : 0), def = pw(d.inf, n);
      sep(); add("Shown in today's ₹", `${I(nominal)} ÷ (1 + ${P(d.inf)})^${n} = ${I(nominal / def)}`, 'total');
    }
    return tipHTML({ title, chip: `Age ${r.age}`, rows: L.map(x => x && { label: x[0], value: x[1], cls: x[2] }), notes });
  }

  // ---------- Chart popups ----------
  function realNote(s, inf, n) {
    return s.sim.display === 'real' ? `Shown in today's ₹: future amounts ÷ (1 + ${(inf * 100).toFixed(1)}%)^${n} = ÷ ${Math.pow(1 + inf, n).toFixed(3)}.` : 'Shown in future (nominal) ₹.';
  }

  function areaTip(k, xs, series) {
    const { s, det } = last;
    const tot = series.reduce((t, x) => t + (x.values[k] || 0), 0);
    return tipHTML({
      title: 'Corpus by asset', chip: k === 0 ? 'Today' : `Age ${xs[k]}`,
      lead: k === 0 ? 'Your corpus today.' : `Balance when you turn ${xs[k]} (end of the year you were ${xs[k] - 1}).`,
      rows: [...series.map(x => ({ label: x.name, color: x.color, value: `${f.short(x.values[k])}  ·  ${tot > 0 ? f.pct(x.values[k] / tot, 0) : '—'}` })), null,
        { label: 'Total corpus', value: f.inr(tot), cls: 'total' }],
      notes: ['Uses the fixed expected returns. Hover over the cells in the year-by-year table to see how each balance is built.', realNote(s, det.inflation, k)],
    });
  }

  function fanTip(k, xs, b, line) {
    const { s, det, mc } = last;
    const dep = k === 0 ? 0 : mc.depletedShare[k - 1];
    return tipHTML({
      title: 'Range of outcomes', chip: k === 0 ? 'Today' : `Age ${xs[k]}`,
      lead: k === 0 ? 'Every path starts from your corpus today.' : `Corpus when you turn ${xs[k]}, across ${mc.runs} simulated market paths.`,
      rows: [
        { label: 'Best 10% (90th percentile)', value: f.inr(b.p90[k]), color: 'rgba(37,99,235,.25)' },
        { label: '75th percentile', value: f.inr(b.p75[k]), color: 'rgba(37,99,235,.5)' },
        { label: 'Median (50th)', value: f.inr(b.p50[k]), color: '#1d4ed8', cls: 'sub' },
        { label: '25th percentile', value: f.inr(b.p25[k]), color: 'rgba(37,99,235,.5)' },
        { label: 'Worst 10% (10th percentile)', value: f.inr(b.p10[k]), color: 'rgba(37,99,235,.25)' },
        null,
        { label: 'Fixed-return projection', value: f.inr(line[k]), color: '#f59e0b' },
        { label: 'Paths already out of money', value: f.pct(dep, 1), cls: dep > 0.1 ? 'bad' : '' },
      ],
      notes: [
        `How it works: each path draws a random return for every asset each year from its expected return and volatility (lognormal, equity–debt correlation ${num(s.sim.corrEqDebt)}), then runs the same spending, tax and rebalancing rules as the table. At each age the ${mc.runs} results are sorted and the percentiles read off.`,
        'Example: "Worst 10%" means 1 in 10 paths had less than this amount at this age.',
        realNote(s, det.inflation, k),
      ],
    });
  }

  function barsTip(k, fr, series, incomeLine) {
    const { s, det } = last;
    const r = fr[k], d = r.d;
    const v = i => series[i].values[k];
    const outTotal = v(0) + v(1) + v(2) + v(3), inc = incomeLine.values[k];
    const real = s.sim.display === 'real', defl = real ? Math.pow(1 + det.inflation, r.y) : 1;
    const drawn = Math.max(0, outTotal - inc);
    const notes = [];
    if (r.retired) {
      notes.push(`Living = ${f.inr(d.spendBase)} × (1 + ${(d.inf * 100).toFixed(1)}%)^${r.y} × ${Math.round(d.phase * 100)}% phase × 12.`);
      notes.push(`Medical = ${f.inr(d.medBase)} × (1 + ${(d.medInf * 100).toFixed(1)}%)^${r.y} × 12, plus premium ${f.inr(d.premBase)} × (1 + ${(d.premInf * 100).toFixed(1)}%)^${r.y}.`);
    } else notes.push(`Before retirement (age ${d.retAge}) your salary covers living costs. Only goals and tax on portfolio income come out of the corpus.`);
    const goals = d.evItems.filter(e => e.type !== 'inflow');
    if (goals.length) notes.push('Goals: ' + goals.map(e => `${e.name} ${f.short(e.amount)}`).join(', ') + ' (today\'s cost grown at each goal\'s inflation).');
    if (r.tax > 0) notes.push('Tax: hover over the Tax cell in the year-by-year table for the full working.');
    notes.push(realNote(s, det.inflation, r.y));
    return tipHTML({
      title: 'Outflows vs income', chip: `Age ${r.age}`,
      rows: [
        ...series.map(x => ({ label: x.name, color: x.color, value: f.inr(x.values[k]) })),
        null,
        { label: 'Total outflows', value: f.inr(outTotal), cls: 'sub' },
        { label: '− Other income', value: f.inr(inc), color: incomeLine.color },
        null,
        { label: 'Drawn from corpus', value: f.inr(drawn), cls: 'total' },
        { label: 'as % of opening corpus', value: r.opening > 0 ? f.pct(drawn * defl / r.opening) : '—', cls: drawn * defl / r.opening > 0.04 ? 'bad' : '' },
      ],
      notes,
    });
  }

  let tipEl = null;
  function tip() {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.id = 'tip'; tipEl.hidden = true; document.body.appendChild(tipEl); }
    return tipEl;
  }
  function placeTip(e) {
    const t = tip(), pad = 14;
    const w = t.offsetWidth, h = t.offsetHeight;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = Math.max(8, e.clientY - h - pad);
    t.style.left = Math.max(8, x) + 'px'; t.style.top = y + 'px';
  }
  function onTipOver(e) {
    const hit = e.target.closest && e.target.closest('g.col');
    const chart = hit && hit.closest('[data-chart]');
    if (chart && chart._tip && last) {
      const t = tip();
      t.innerHTML = chart._tip(+hit.dataset.k);
      t.hidden = false;
      placeTip(e);
      return;
    }
    const td = e.target.closest && e.target.closest('#yearTable td[data-c]');
    if (!td || !last) { if (tipEl) tipEl.hidden = true; return; }
    const r = last.det.rows.find(x => x.y === +td.dataset.y);
    const col = yearCols()[+td.dataset.c];
    if (!r || !col || !r.d) return;
    const t = tip();
    t.innerHTML = explain(col, r);
    t.hidden = false;
    placeTip(e);
  }

  function toCSV() {
    if (!last) return '';
    const cols = yearCols();
    const q = v => `"${String(v).replace(/"/g, '""')}"`;
    return [cols.map(c => q(c[0])).join(',')].concat(last.det.rows.map(r => cols.map(c => Math.round(c[1](r))).join(','))).join('\n')
      + `\n\n${q('Values in ' + (last.s.sim.display === 'real' ? "today's rupees" : 'future (nominal) rupees'))}`;
  }

  function renderScenarios() {
    const list = RP.state.loadScenarios();
    const el = $('#scenarios');
    if (!list.length) { el.innerHTML = '<p class="muted">No saved scenarios yet. Use <b>Save scenario</b> at the top to keep a version of your plan and compare it here.</p>'; return; }
    const items = [{ name: 'Current plan', state: S(), current: true }, ...list];
    const m = items.map(it => {
      const r = RP.engine.run(it.state, { light: true });
      const retY = Math.max(0, num(it.state.profile.retireAge) - r.startAge);
      return {
        corpusRet: r.corpusAtRet != null ? r.corpusAtRet / Math.pow(1 + r.inflation, retY) : null,
        lasts: r.depletedAge != null ? 'Age ' + f.age(r.depletedAge) : `Age ${r.startAge + r.N}+`,
        endReal: r.endReal, wr: r.firstYearWR, sus: RP.solver.sustainableMonthly(it.state),
        spend: num(it.state.spending.monthly), retAge: it.state.profile.retireAge, success: r.success,
      };
    });
    const row = (label, fn) => `<tr><th>${label}</th>${m.map(fn).map(v => `<td>${v}</td>`).join('')}</tr>`;
    el.innerHTML = '<div class="tablewrap"><table class="data compare"><thead><tr><th></th>'
      + items.map((it, i) => `<th>${esc(it.name)}${it.current ? '' : `<div class="scn-actions"><button data-load-scn="${i - 1}">Load</button><button data-del-scn="${i - 1}" class="danger">Delete</button></div>`}</th>`).join('')
      + '</tr></thead><tbody>'
      + row('Retirement age', x => esc(x.retAge))
      + row('Planned spend / mo (today)', x => f.short(x.spend))
      + row('Corpus at retirement (today\'s ₹)', x => f.short(x.corpusRet))
      + row('Money lasts until', x => x.lasts)
      + row('End corpus (today\'s ₹)', x => f.short(x.endReal))
      + row('First-year withdrawal rate', x => f.pct(x.wr))
      + row('Sustainable spend / mo', x => f.short(x.sus))
      + row('Result', x => `<span class="chip ${x.success ? 'ok' : 'danger'}">${x.success ? 'Survives' : 'Fails'}</span>`)
      + '</tbody></table></div>';
  }

  function showError(e) { const el = $('#error'); el.hidden = false; el.textContent = 'Calculation error: ' + (e && e.message ? e.message : e); }
  function clearError() { $('#error').hidden = true; }

  function init(handlers) {
    H = handlers;
    renderAllLists();
    populate(document);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onInput);
    document.addEventListener('click', onClick);
    document.addEventListener('mouseover', onTipOver);
    document.addEventListener('mousemove', e => { if (tipEl && !tipEl.hidden) placeTip(e); });
    document.addEventListener('scroll', () => { if (tipEl) tipEl.hidden = true; }, true);
    $('#fileImport').addEventListener('change', onImport);
  }
  function refreshAll() { renderAllLists(); populate(document); }

  RP.ui = { init, refreshAll, renderResults, showError, clearError };
})(window.RP);
