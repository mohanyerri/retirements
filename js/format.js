/* Number formatting helpers (Indian lakh / crore conventions). */
window.RP = window.RP || {};
(function (RP) {
  'use strict';
  const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

  function trim(x, d) { return Number(x.toFixed(d)).toString(); }

  /** Full rupee format: ₹1,25,00,000 */
  function inr(n) {
    if (n == null || !isFinite(n)) return '—';
    const sign = n < 0 ? '-' : '';
    return sign + '₹' + nf0.format(Math.round(Math.abs(n)));
  }

  /** Short rupee format: ₹1.25 Cr, ₹12.5 L, ₹45 K */
  function short(n) {
    if (n == null || !isFinite(n)) return '—';
    const a = Math.abs(n), sign = n < 0 ? '-' : '';
    if (a >= 1e7) return sign + '₹' + trim(a / 1e7, 2) + ' Cr';
    if (a >= 1e5) return sign + '₹' + trim(a / 1e5, 2) + ' L';
    if (a >= 1e3) return sign + '₹' + trim(a / 1e3, 1) + ' K';
    return sign + '₹' + Math.round(a);
  }

  /** Fraction → percent string: 0.0325 → "3.3%" */
  function pct(x, d = 1) {
    if (x == null || !isFinite(x)) return '—';
    return (x * 100).toFixed(d) + '%';
  }

  /** Fractional age → "76 y 8 m" */
  function age(a) {
    if (a == null || !isFinite(a)) return '—';
    const y = Math.floor(a + 1e-9);
    const m = Math.round((a - y) * 12);
    if (m === 0 || m === 12) return String(m === 12 ? y + 1 : y);
    return `${y} y ${m} m`;
  }

  RP.fmt = { inr, short, pct, age };
})(window.RP);
