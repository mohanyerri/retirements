/* Shared motion helpers.
   Principle: entrance animations play when a section first appears or a tab is opened, never on every
   keystroke. While typing, numbers glide from their previous value to the new one instead. */
window.RP = window.RP || {};
(function (RP) {
  'use strict';
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const ease = t => 1 - Math.pow(1 - t, 3);
  const last = {};   // previous value per key, so re-rendered cards still glide from where they were

  /** Animate el's text from its previous value (by key) to `to`. fmt(number) → string. */
  function countUp(el, to, fmt, key, dur = 900) {
    if (!el) return;
    cancelAnimationFrame(el._raf);
    const prev = key != null ? last[key] : el._v;
    if (key != null) last[key] = to;
    el._v = to;
    if (reduced() || !isFinite(to)) { el.textContent = fmt(to); return; }
    const from = prev != null && isFinite(prev) ? prev : to * 0.6;
    if (from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const tick = t => {
      const p = Math.min(1, (t - t0) / dur);
      el.textContent = fmt(from + (to - from) * ease(p));
      if (p < 1) el._raf = requestAnimationFrame(tick);
    };
    el.textContent = fmt(from);
    el._raf = requestAnimationFrame(tick);
  }

  /** True the first time `el` is shown (since the last reset): use it to decide whether to play an entrance. */
  function entrance(el) {
    if (!el || reduced()) return false;
    if (el.dataset.animIn) return false;
    el.dataset.animIn = '1';
    return true;
  }
  /** Forget entrances inside root (called when a tab is opened, so its entrances replay). */
  function reset(root) {
    (root || document).querySelectorAll('[data-anim-in]').forEach(el => { delete el.dataset.animIn; });
  }

  /** Give children a staggered rise-in (CSS class .anim-rise with --d delay). */
  function stagger(container, selector, step = 55, max = 12) {
    if (!container) return;
    Array.from(container.querySelectorAll(selector)).forEach((el, i) => {
      el.style.setProperty('--d', Math.min(i, max) * step + 'ms');
      el.classList.remove('anim-rise'); void el.getBoundingClientRect(); el.classList.add('anim-rise');
      // drop the class when done, so hover effects (which use transform) work again
      el.addEventListener('animationend', function done(e) {
        if (e.target !== el) return;
        el.classList.remove('anim-rise'); el.removeEventListener('animationend', done);
      });
    });
  }

  /** Replay a one-shot CSS animation class on el. */
  function replay(el, cls) {
    if (!el || reduced()) return;
    el.classList.remove(cls); void el.getBoundingClientRect(); el.classList.add(cls);   // reflow (works for SVG too)
  }

  /** Replay a panel's entrance when its tab is opened (charts draw again, cards rise again). */
  function replayPanel(panel) {
    if (!panel || reduced()) return;
    panel.querySelectorAll('svg.chart').forEach(svg => replay(svg, 'anim-draw'));
    panel.querySelectorAll('.cards, .scards, .b-kpis').forEach(c => stagger(c, '.card, .scard', 55));
  }

  RP.anim = { reduced, countUp, entrance, reset, stagger, replay, replayPanel };
})(window.RP);
