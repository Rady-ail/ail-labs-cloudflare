/* AIL LABS — depth layer: kartu 3D tilt, parallax hero, mikro-interaksi tekan.
   Vanilla JS, hanya properti `translate`/`scale` terpisah + transform kartu; tidak menyentuh pseudo-element kaca.
   Nonaktif otomatis untuk prefers-reduced-motion dan perangkat tanpa pointer halus. */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---------- 1. Tekan: skala pegas ringan pada tombol ---------- */
  var st = document.createElement('style');
  st.textContent =
    '.ad-press{scale:1;transition:scale .38s cubic-bezier(.34,1.56,.64,1)}' +
    '.ad-press.ad-down{scale:.965;transition:scale .09s ease-out}' +
    '.ad-tilt{will-change:transform;transform-style:preserve-3d}' +
    '.ad-tilt.ad-rest{transition:transform .6s cubic-bezier(.22,1,.36,1)}';
  document.head.appendChild(st);
  var PRESS = '.btn-metal,main button,main a[class*="rounded-xl"][class*="font-bold"],main a[class*="rounded-full"]';
  [].slice.call(document.querySelectorAll(PRESS)).forEach(function (b) { b.classList.add('ad-press'); });
  document.addEventListener('pointerdown', function (e) {
    var b = e.target.closest && e.target.closest('.ad-press'); if (b) b.classList.add('ad-down');
  }, { passive: true });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) {
    document.addEventListener(t, function () {
      [].slice.call(document.querySelectorAll('.ad-down')).forEach(function (b) { b.classList.remove('ad-down'); });
    }, { passive: true });
  });

  /* ---------- 2. Kartu 3D tilt (mouse/pen saja) ---------- */
  if (fine) {
    var CARD = '.panel-card,.category,.feature,.step,.compliance-card,.stat,.card,main [class*="bg-ail-clinical"][class*="rounded-2xl"]';
    var MAX = 5, active = null, raf = 0, px = 0, py = 0;
    function ok(el) {
      var w = el.offsetWidth;
      return w > 120 && w < 540 && !el.querySelector('form,input,textarea,select');
    }
    function paint() {
      raf = 0; if (!active) return;
      var r = active.getBoundingClientRect();
      var x = (px - r.left) / r.width - .5, y = (py - r.top) / r.height - .5;
      active.style.transform = 'perspective(900px) rotateX(' + (-y * MAX * 2).toFixed(2) + 'deg) rotateY(' +
        (x * MAX * 2).toFixed(2) + 'deg) translateZ(8px)';
    }
    document.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      var el = e.target.closest && e.target.closest(CARD);
      if (el !== active) {
        if (active) { active.classList.add('ad-rest'); active.style.transform = ''; }
        active = el && ok(el) ? el : null;
        if (active) { active.classList.add('ad-tilt'); active.classList.remove('ad-rest'); }
      }
      if (!active) return;
      px = e.clientX; py = e.clientY;
      if (!raf) raf = requestAnimationFrame(paint);
    }, { passive: true });
    document.documentElement.addEventListener('mouseleave', function () {
      if (active) { active.classList.add('ad-rest'); active.style.transform = ''; active = null; }
    }, { passive: true });
  }

  /* ---------- 3. Parallax hero (properti `translate`, aman dari transform yang ada) ---------- */
  var orb = document.querySelector('[data-hero-orb]'), panel = document.querySelector('[data-hero-3d]');
  if (orb || panel) {
    var ticking = false;
    function par() {
      ticking = false;
      var y = Math.min(window.scrollY, 900);
      if (orb) orb.style.translate = '0 ' + (-y * 0.14).toFixed(1) + 'px';
      if (panel) panel.style.translate = '0 ' + (-y * 0.06).toFixed(1) + 'px';
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(par); }
    }, { passive: true });
  }
})();
