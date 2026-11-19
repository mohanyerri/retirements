/* Deterministic monthly projection engine. Pure: state in → result out, no DOM.
   Time model: plan year y = 0..N-1, age = currentAge + y. Inside a year there are 12 monthly
   steps; inflation step-ups, tax, LTCG harvesting and rebalancing happen once at year end. */
window.RP = window.RP || {};
(function (RP) {
  'use strict';
  const TAX_TYPES = ['slabAccrual', 'slabRedeem', 'ltcgOther', 'equity', 'exempt']; // also the tax-efficient withdrawal order
  const sum = a => { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return t; };
  const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : (isFinite(parseFloat(v)) ? parseFloat(v) : d));

  function horizonYears(s) {
    const p = s.profile;
    if (num(p.yearsOverride) > 0) return Math.round(num(p.yearsOverride));
    let n = num(p.planUntil) - num(p.currentAge);
    if (p.useSpouse && num(p.spousePlanUntil) > 0) n = Math.max(n, num(p.spousePlanUntil) - num(p.spouseAge));
    return Math.max(1, Math.min(80, Math.round(n)));
  }

  function initialAmounts(s) {
    if (s.allocMode === 'percent') return s.assets.map(a => num(s.totalCorpus) * Math.max(0, num(a.targetPct)) / 100);
    return s.assets.map(a => Math.max(0, num(a.amount)));
  }

  function baseWeights(s, amounts) {
    const w = s.allocMode === 'percent' ? s.assets.map(a => Math.max(0, num(a.targetPct))) : amounts.slice();
    const t = sum(w);
    if (t <= 0) return s.assets.map(() => 1 / Math.max(1, s.assets.length));
    return w.map(x => x / t);
  }

  function phaseMult(phases, age) {
    let m = 1, best = -Infinity;
    for (const ph of phases || []) {
      const f = num(ph.fromAge);
      if (age >= f && f >= best) { best = f; m = num(ph.pct, 100) / 100; }
    }
    return m;
  }

  function eventOccursAt(ev, age) {
    const a0 = Math.round(num(ev.age));
    if (age < a0) return false;
    if (age === a0) return true;
    const every = Math.round(num(ev.repeatEvery));
    if (every <= 0 || age > num(ev.repeatUntil)) return false;
    return (age - a0) % every === 0;
  }

  /**
   * opts.light     – skip detailed rows (Monte Carlo / solvers)
   * opts.returnsFn – (yearIndex, assetIndex) => gross annual return (fraction); overrides asset.ret
   * opts.crash     – e.g. -0.30: equity return in the first retirement year
   * opts.shocks    – [{ year, cls, ret }]: override the return of every asset of class `cls` in plan year `year`
   * opts.monthlyLog – record month-by-month bucket balances (months[]) and refill events (events[])
   *
   * Bucket strategy settings (strategy.order === 'bucket'):
   *   bucket1Years / bucket2Years – target size of bucket 1 / 2 in years of net spending
   *   refillFreq   – 'annual' (default, year-end) | 'quarterly' | 'monthly' (checked at month end)
   *   refillTrigger – months: only act when bucket 1 is this many months below target (monthly/quarterly)
   *   harvestBand  – e.g. 0.2: when growth is > target share × 1.2, move the excess to bucket 2 (good markets)
   *   bucketRatio  – optional 0..1: target share of bucket 3 within buckets 2+3. When set, buckets 2/3 are
   *                  rebalanced to this ratio every year end instead of the legacy "top up bucket 2" rule:
   *                  trim growth into income when it runs ahead (lock in gains), buy growth from income after
   *                  a fall (buy low), but never let income drop below bucketMinB2Years of spending.
   *   bucketBand   – rebalance only when the ratio is off by more than this (fraction, default 0.05)
   */
  function run(s, opts = {}) {
    const P = s.profile, S = s.spending, St = s.strategy, T = s.tax;
    const N = horizonYears(s);
    const A = s.assets || [], nA = A.length;
    const curAge = Math.round(num(P.currentAge)), retAge = Math.round(num(P.retireAge));
    const inf = num(S.inflation) / 100, medInf = num(S.medicalInflation) / 100, premInf = num(S.premiumInflation) / 100;
    const ttype = A.map(a => (TAX_TYPES.includes(a.taxType) ? a.taxType : 'slabAccrual'));
    const isEq = A.map(a => a.cls === 'equity');
    const lockAge = A.map(a => num(a.lockUntilAge));

    const amounts = initialAmounts(s);
    const bal = amounts.slice();
    const basis = A.map((a, i) => (ttype[i] === 'slabAccrual' || ttype[i] === 'exempt')
      ? bal[i] : bal[i] * Math.min(1, Math.max(0, num(a.costBasisPct, 100) / 100)));
    const w0 = baseWeights(s, amounts);
    let eq0 = 0; for (let i = 0; i < nA; i++) if (isEq[i]) eq0 += w0[i];

    const taxOn = !!(T && T.enabled);
    const gains = { slabAccrual: 0, slabRedeem: 0, ltcgOther: 0, equity: 0, exempt: 0 };
    const all = A.map((_, i) => i);
    const byTax = TAX_TYPES.map(t => all.filter(i => ttype[i] === t));
    const byBucket = [1, 2, 3].map(b => all.filter(i => Math.round(num(A[i].bucket, 3)) === b));
    const groups = St.order === 'bucket' ? byBucket : St.order === 'taxefficient' ? byTax : [all];
    let age = curAge;
    let sold = new Array(nA).fill(0), bought = new Array(nA).fill(0);

    const unlocked = i => lockAge[i] <= age;

    function targetWeights() {
      if (!St.glideEnabled || age < retAge || eq0 <= 0 || eq0 >= 1) return w0;
      const floor = num(St.glideFloor) / 100, step = num(St.glideStep) / 100;
      if (eq0 <= floor) return w0;
      const eqT = Math.max(floor, eq0 - step * (age - retAge));
      const fe = eqT / eq0, fo = (1 - eqT) / (1 - eq0);
      return w0.map((w, i) => w * (isEq[i] ? fe : fo));
    }

    // Sell `amt` of asset i, booking the gain portion against its tax bucket.
    function realize(i, amt) {
      if (amt <= 0 || bal[i] <= 0) return 0;
      amt = Math.min(amt, bal[i]);
      const cb = basis[i] * (amt / bal[i]);
      gains[ttype[i]] += amt - cb;
      basis[i] -= cb; bal[i] -= amt; sold[i] += amt;
      if (bal[i] < 1e-6) { bal[i] = 0; basis[i] = 0; }
      return amt;
    }

    function withdrawGroups(gs, amt) {
      let rem = amt;
      for (const g of gs) {
        if (rem <= 1e-9) break;
        const idx = g.filter(i => bal[i] > 0 && unlocked(i));
        const tot = sum(idx.map(i => bal[i]));
        if (tot <= 0) continue;
        const take = Math.min(rem, tot);
        const shares = idx.map(i => bal[i] / tot);
        idx.forEach((i, k) => realize(i, take * shares[k]));
        rem -= take;
      }
      return amt - rem;
    }
    const withdraw = amt => withdrawGroups(groups, amt);

    function deposit(amt, subset) {
      if (amt <= 0) return 0;
      const base = subset || all;
      let idx = base.filter(unlocked);
      if (!idx.length) idx = base;
      if (!idx.length) return 0;
      const tw = targetWeights();
      let ws = idx.map(i => tw[i]), t = sum(ws);
      if (t <= 0) { ws = idx.map(() => 1); t = idx.length; }
      idx.forEach((i, k) => { const v = amt * ws[k] / t; bal[i] += v; basis[i] += v; bought[i] += v; });
      return amt;
    }

    function rebalance() {
      const tw = targetWeights();
      const idx = all.filter(unlocked);
      const tot = sum(idx.map(i => bal[i]));
      let wt = idx.map(i => tw[i]); const t = sum(wt);
      if (tot <= 0 || t <= 0) return;
      wt = wt.map(x => x / t);
      if (St.rebalance === 'threshold') {
        const thr = num(St.rebalanceThreshold, 5) / 100;
        if (!idx.some((i, k) => Math.abs(bal[i] / tot - wt[k]) > thr)) return;
      }
      const diff = idx.map((i, k) => wt[k] * tot - bal[i]);
      idx.forEach((i, k) => { if (diff[k] < 0) realize(i, -diff[k]); });
      idx.forEach((i, k) => { if (diff[k] > 0) { bal[i] += diff[k]; basis[i] += diff[k]; bought[i] += diff[k]; } });
    }

    function needAt(a) {   // monthly, nominal ₹
      if (a < retAge) return { spend: 0, med: 0, prem: 0 };
      const y = a - curAge;
      return {
        spend: num(S.monthly) * Math.pow(1 + inf, y) * phaseMult(S.phases, a),
        med: num(S.medicalMonthly) * Math.pow(1 + medInf, y),
        prem: num(S.premiumAnnual) * Math.pow(1 + premInf, y) / 12,
      };
    }
    function incomeAt(a) { // monthly, nominal ₹ (amount is in today's ₹, grows at `growth` from today)
      const r = { total: 0, pension: 0, rent: 0, slab: 0, exempt: 0, items: [] };
      for (const inc of s.incomes || []) {
        if (a >= num(inc.startAge) && a < num(inc.endAge, 200)) {
          const v = num(inc.monthly) * Math.pow(1 + num(inc.growth) / 100, a - curAge);
          r.total += v;
          r.items.push({ name: inc.name, today: num(inc.monthly), growth: num(inc.growth), monthly: v, tax: inc.tax });
          r[r.hasOwnProperty(inc.tax) ? inc.tax : 'slab'] += v;
        }
      }
      return r;
    }

    // ---- Bucket refill (time-segmentation) ----
    const freq = St.refillFreq === 'monthly' ? 1 : St.refillFreq === 'quarterly' ? 3 : 12;
    const b3Share0 = byBucket[2].reduce((t, i) => t + w0[i], 0);
    const log = opts.monthlyLog ? { months: [], events: [] } : null;
    let b3Index = 1;                 // growth index of bucket 3, for the trailing-12-month market signal
    const b3Hist = [];
    const totG = g => { let t = 0; for (const i of g) t += bal[i]; return t; };
    const logEvent = (mAbs, type, from, to, amount, marketRet) => {
      if (log && amount > 0.5) log.events.push({ m: mAbs, age: curAge + mAbs / 12, type, from, to, amount, marketRet });
    };

    /** Refill buckets. annualNeed = next 12 months' net spending; good = markets up over the last 12 months. */
    function refillBuckets(annualNeed, good, marketRet, mAbs, trigger) {
      if (!byBucket[0].length) return;
      const b1T = annualNeed * num(St.bucket1Years, 2), b2T = annualNeed * num(St.bucket2Years, 5);
      const d1 = b1T - totG(byBucket[0]);
      if (d1 > Math.max(0, trigger)) {
        if (good) {
          const fromB3 = withdrawGroups([byBucket[2]], d1);
          logEvent(mAbs, 'refill', 3, 1, fromB3, marketRet);
          const rest = withdrawGroups([byBucket[1]], d1 - fromB3);
          logEvent(mAbs, 'refill', 2, 1, rest, marketRet);
          deposit(fromB3 + rest, byBucket[0]);
        } else {
          const fromB2 = withdrawGroups([byBucket[1]], d1);
          logEvent(mAbs, 'protect', 2, 1, fromB2, marketRet);
          const rest = withdrawGroups([byBucket[2]], d1 - fromB2);
          logEvent(mAbs, 'refill', 3, 1, rest, marketRet);
          deposit(fromB2 + rest, byBucket[0]);
        }
      }
      if (num(St.bucketRatio) > 0) return;   // buckets 2/3 handled by rebalanceRatio() at year end
      if (good && byBucket[1].length) {
        const d2 = b2T - totG(byBucket[1]);
        if (d2 > Math.max(0, trigger)) {
          const got = withdrawGroups([byBucket[2]], d2);
          logEvent(mAbs, 'refill', 3, 2, got, marketRet);
          deposit(got, byBucket[1]);
        }
        const band = num(St.harvestBand);
        if (band > 0 && b3Share0 > 0) {
          const total = sum(bal), b3 = totG(byBucket[2]);
          const excess = b3 - b3Share0 * total;
          if (b3 > b3Share0 * total * (1 + band) && excess > 0) {
            const got = withdrawGroups([byBucket[2]], excess);
            logEvent(mAbs, 'harvest', 3, 2, got, marketRet);
            deposit(got, byBucket[1]);
          }
        }
      }
    }

    /** Year-end: keep growth at its target share of (income + growth). */
    function rebalanceRatio(annualNeed, mAbs, marketRet) {
      const rho = num(St.bucketRatio);
      if (!(rho > 0) || !byBucket[1].length || !byBucket[2].length) return;
      const b2 = totG(byBucket[1]), b3 = totG(byBucket[2]), pool = b2 + b3;
      if (pool <= 0) return;
      const band = St.bucketBand != null ? num(St.bucketBand) : 0.05;
      const share = b3 / pool;
      if (share > rho + band) {
        const got = withdrawGroups([byBucket[2]], (share - rho) * pool);
        logEvent(mAbs, 'harvest', 3, 2, got, marketRet);
        deposit(got, byBucket[1]);
      } else if (share < rho - band) {
        const floor = num(St.bucketMinB2Years != null ? St.bucketMinB2Years : 2) * annualNeed;
        const amt = Math.min((rho - share) * pool, Math.max(0, b2 - floor));
        if (amt > 0) {
          const got = withdrawGroups([byBucket[1]], amt);
          logEvent(mAbs, 'buydip', 2, 3, got, marketRet);
          deposit(got, byBucket[2]);
        }
      }
    }

    const rows = opts.light ? null : [];
    const totals = [];
    let depletedAge = null, shortfallTotal = 0, corpusAtRet = null, firstYearWR = null, firstYearNeedAnnual = null;
    let totalTax = 0;

    for (let y = 0; y < N; y++) {
      age = curAge + y;
      const retired = age >= retAge;
      const opening = sum(bal);
      const openBal = bal.slice();
      sold = new Array(nA).fill(0); bought = new Array(nA).fill(0);
      if (retired && corpusAtRet === null) corpusAtRet = opening;

      let rates = A.map((a, i) => (opts.returnsFn ? opts.returnsFn(y, i) : num(a.ret) / 100));
      if (opts.crash != null && age === Math.max(retAge, curAge)) rates = rates.map((r, i) => (isEq[i] ? opts.crash : r));
      if (opts.shocks) for (const sh of opts.shocks) if (sh.year === y) rates = rates.map((r, i) => (A[i].cls === sh.cls ? sh.ret : r));
      rates = rates.map((r, i) => r - num(A[i].fee) / 100);
      const mRate = rates.map(r => Math.pow(1 + Math.max(r, -0.99), 1 / 12) - 1);

      const nd = needAt(age), inc = incomeAt(age);
      const needM = nd.spend + nd.med + nd.prem;
      const sipM = retired ? 0 : num(s.presave && s.presave.sip) * Math.pow(1 + num(s.presave && s.presave.stepUp) / 100, y);

      let evIn = 0, evOut = 0;
      const evItems = [];
      for (const ev of s.events || []) {
        if (!eventOccursAt(ev, age)) continue;
        const v = num(ev.amount) * Math.pow(1 + num(ev.inflation) / 100, y);
        evItems.push({ name: ev.name, type: ev.type, today: num(ev.amount), infl: num(ev.inflation), amount: v });
        if (ev.type === 'inflow') evIn += v; else evOut += v;
      }

      let yShort = 0, yWithdrawn = 0, yContrib = 0, ySurplus = 0, yGoalW = 0, ySpendW = 0, yTaxW = 0, ySip = 0;
      const growth = new Array(nA).fill(0);
      const markShort = m => { if (yShort > 1 && depletedAge === null) depletedAge = age + m / 12; };

      if (evIn > 0) yContrib += deposit(evIn);
      if (evOut > 0) { const got = withdraw(evOut); yWithdrawn += got; yGoalW = got; yShort += evOut - got; markShort(0); }

      for (let m = 0; m < 12; m++) {
        for (let i = 0; i < nA; i++) {
          const g = bal[i] * mRate[i];
          bal[i] += g; growth[i] += g;
          if (ttype[i] === 'slabAccrual' || ttype[i] === 'exempt') basis[i] += g;
        }
        if (sipM > 0) { const d = deposit(sipM); yContrib += d; ySip += d; }
        const net = needM - inc.total;
        let paidM = 0, shortM = 0;
        if (net > 0) {
          const got = withdraw(net);
          paidM = got;
          yWithdrawn += got; ySpendW += got;
          if (net - got > 1e-6) { yShort += net - got; shortM = net - got; }
          const wasDepleted = depletedAge !== null;
          markShort(m);
          if (!wasDepleted && depletedAge !== null) logEvent(y * 12 + m, 'depleted', 0, 0, shortM, 0);
        } else if (net < 0) ySurplus += deposit(-net);

        // bucket-3 market signal (trailing 12 months)
        if (St.order === 'bucket') {
          let w = 0, r = 0;
          for (const i of byBucket[2]) { w += bal[i]; r += bal[i] * mRate[i]; }
          b3Index *= 1 + (w > 0 ? r / w : 0);
          b3Hist.push(b3Index);
          if (freq < 12 && (m + 1) % freq === 0 && age + 1 >= retAge) {
            const mAbs = y * 12 + m;
            const back = b3Hist[Math.max(0, b3Hist.length - 13)];
            const trail = b3Index / back - 1;
            const nextAge = m === 11 ? age + 1 : age;
            const nn = needAt(nextAge), ni = incomeAt(nextAge);
            const annualNeed = Math.max(0, (nn.spend + nn.med + nn.prem - ni.total) * 12);
            refillBuckets(annualNeed, trail >= 0, trail, mAbs, num(St.refillTrigger) * annualNeed / 12);
            if (m === 11) rebalanceRatio(annualNeed, mAbs, trail);
          }
        }
        if (log) {
          const bs = byBucket.map(g => totG(g));
          log.months.push({ m: y * 12 + m, age: age + (m + 1) / 12, b1: bs[0], b2: bs[1], b3: bs[2], total: sum(bal), paid: paidM, short: shortM });
        }
      }
      for (let i = 0; i < nA; i++) if (ttype[i] === 'slabAccrual') gains.slabAccrual += growth[i];

      // ---- Year-end tax ----
      let yTax = 0, taxInfo = null;
      const realizedEq = gains.equity;
      if (taxOn) {
        taxInfo = RP.tax.compute({
          retired, age,
          interest: Math.max(0, gains.slabAccrual), slabGains: Math.max(0, gains.slabRedeem),
          ltcgEq: Math.max(0, gains.equity), ltcgOther: Math.max(0, gains.ltcgOther),
          pension: inc.pension * 12, rent: inc.rent * 12, otherSlab: inc.slab * 12,
        }, T);
        yTax = taxInfo.total;
      }
      for (const k in gains) gains[k] = 0;
      if (yTax > 0) { const got = withdraw(yTax); yWithdrawn += got; yTaxW = got; yShort += yTax - got; markShort(11); }

      // ---- Harvest tax-free equity LTCG (sell & rebuy to reset cost) ----
      if (taxOn && St.harvestLTCG) {
        const room = num(T.ltcgExempt) - Math.max(0, realizedEq);
        const eqIdx = all.filter(i => ttype[i] === 'equity' && bal[i] > basis[i]);
        const unreal = sum(eqIdx.map(i => bal[i] - basis[i]));
        if (room > 0 && unreal > 0) {
          const f = Math.min(1, room / unreal);
          eqIdx.forEach(i => { basis[i] += (bal[i] - basis[i]) * f; });
        }
      }

      // ---- Bucket refill or rebalancing ----
      if (St.order === 'bucket') {
        if (freq === 12 && age + 1 >= retAge && byBucket[0].length) {
          const nn = needAt(age + 1), ni = incomeAt(age + 1);
          const annual = Math.max(0, (nn.spend + nn.med + nn.prem - ni.total) * 12);
          let b3w = 0, b3r = 0;
          byBucket[2].forEach(i => { b3w += openBal[i]; b3r += openBal[i] * rates[i]; });
          const yr = b3w > 0 ? b3r / b3w : 0;
          refillBuckets(annual, b3w > 0 ? yr > 0 : false, yr, y * 12 + 11, 0);
          rebalanceRatio(annual, y * 12 + 11, yr);
        }
      } else if (St.rebalance && St.rebalance !== 'none') {
        rebalance();
      }

      const closing = sum(bal);
      totals.push(closing);
      shortfallTotal += yShort;
      totalTax += yTax;
      if (retired && firstYearWR === null && corpusAtRet > 0) {
        firstYearNeedAnnual = (needM - inc.total) * 12;
        firstYearWR = firstYearNeedAnnual / corpusAtRet;
      }
      if (rows) rows.push({
        y, age, retired, opening, contrib: yContrib, income: inc.total * 12,
        spend: nd.spend * 12, medical: (nd.med + nd.prem) * 12, goals: evOut,
        growth: sum(growth), tax: yTax, withdrawn: yWithdrawn, shortfall: yShort,
        closing, balances: bal.slice(),
        d: {
          inf, medInf, premInf, phase: phaseMult(S.phases, age), retAge,
          spendBase: num(S.monthly), medBase: num(S.medicalMonthly), premBase: num(S.premiumAnnual),
          needM, incM: inc.total, incItems: inc.items, evItems,
          sipBase: num(s.presave && s.presave.sip), stepUp: num(s.presave && s.presave.stepUp), sipM, sip: ySip, inflows: evIn,
          surplus: ySurplus, spendW: ySpendW, goalW: yGoalW, taxW: yTaxW,
          openBal, rates: rates.slice(), growthBy: growth.slice(), sold: sold.slice(), bought: bought.slice(),
          tax: taxInfo, taxOn, order: St.order, rebalance: St.rebalance,
        },
      });
    }

    const endBal = sum(bal);
    const legacyNominal = num(St.legacyToday) * Math.pow(1 + inf, N);
    return {
      N, rows, totals, depletedAge, shortfallTotal, corpusAtRet, firstYearWR, firstYearNeedAnnual,
      totalTax, endBal, endReal: endBal / Math.pow(1 + inf, N), legacyNominal,
      success: shortfallTotal < 1 && endBal >= legacyNominal - 1,
      inflation: inf, startAge: curAge, initialAmounts: amounts, initialTotal: sum(amounts), eq0,
      months: log ? log.months : null, events: log ? log.events : null,
    };
  }

  RP.engine = { run, horizonYears, initialAmounts, baseWeights, phaseMult, num };
})(window.RP);
