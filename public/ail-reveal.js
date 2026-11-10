/* AIL LABS — scroll reveal + progress bar. Motion 11 (window.Motion), presentation only.
   Progressive enhancement: no Motion or prefers-reduced-motion => content stays as is. */
(function () {
  'use strict';
  var M = window.Motion;
  if (!M || !M.animate || !M.inView) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var ease = [0.22, 1, 0.36, 1];
  var targets = [].slice.call(document.querySelectorAll('main > div, main > section > div, main > section > h2'));
  var vh = window.innerHeight || 800;

  targets.forEach(function (el, i) {
    // Elemen yang sudah terlihat saat load: cukup fade-in halus, tanpa disembunyikan lebih dulu.
    var r = el.getBoundingClientRect();
    if (r.top < vh * 0.9) {
      M.animate(el, { opacity: [0, 1], transform: ['translateY(10px)', 'none'] },
        { duration: 0.55, delay: Math.min(i, 3) * 0.06, easing: ease })
        .finished.then(function () { el.style.transform = ''; el.style.opacity = ''; }, function () {});
      return;
    }
    el.style.opacity = '0';
    M.inView(el, function () {
      M.animate(el, { opacity: [0, 1], transform: ['translateY(22px)', 'none'] },
        { duration: 0.6, easing: ease })
        .finished.then(function () { el.style.opacity = ''; el.style.transform = ''; }, function () {
          el.style.opacity = ''; el.style.transform = '';
        });
    }, { margin: '0px 0px -10% 0px' });
  });

  // Anak grid (kartu) masuk berurutan.
  [].slice.call(document.querySelectorAll('main .grid')).forEach(function (g) {
    var kids = [].slice.call(g.children).filter(function (k) { return k.nodeType === 1 && !k.style.opacity && !k.hasAttribute('aria-hidden') && !k.querySelector('[aria-hidden="true"]') && k.getBoundingClientRect().top >= vh * 0.9; });
    if (kids.length < 2 || kids.length > 12) return;
    kids.forEach(function (k) { k.style.opacity = '0'; });
    M.inView(g, function () {
      var a = M.animate(kids, { opacity: [0, 1], transform: ['translateY(14px)', 'none'] },
        { duration: 0.5, delay: M.stagger ? M.stagger(0.06) : 0, easing: ease });
      a.finished.then(function () { kids.forEach(function (k) { k.style.opacity = ''; k.style.transform = ''; }); },
        function () { kids.forEach(function (k) { k.style.opacity = ''; k.style.transform = ''; }); });
    }, { margin: '0px 0px -8% 0px' });
  });

  // Bar progres scroll tipis di atas halaman.
  if (M.scroll) {
    var bar = document.createElement('div');
    bar.setAttribute('aria-hidden', 'true');
    bar.style.cssText = 'position:fixed;left:0;top:0;height:2px;width:100%;transform-origin:0 50%;transform:scaleX(0);' +
      'background:linear-gradient(90deg,#0aa7b5,#f07b4f);z-index:60;pointer-events:none';
    document.body.appendChild(bar);
    M.scroll(function (p) { bar.style.transform = 'scaleX(' + p + ')'; });
  }
})();
