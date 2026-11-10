/* AIL Workspace — animasi tambahan (Motion). Tidak mengubah data/logika aplikasi.
   Keluar sendiri bila Motion tidak ada atau pengguna meminta gerak dikurangi. */
(function () {
  'use strict';
  var M = window.Motion;
  if (!M || !M.animate) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var animate = M.animate;
  var SEL = '.kpi-card,.glass-panel,.content-panel,.sup-card,.sup-tile,.worker-item,.pg-item,.system-item,.empty-state';
  var seen = new WeakSet();
  var queue = [];
  var raf = 0;

  function flush() {
    raf = 0;
    var batch = queue.splice(0, 24);
    batch.forEach(function (el, i) {
      if (!el.isConnected) return;
      try {
        animate(el, { opacity: [0, 1], translate: ['0 14px', '0 0'] },
          { duration: 0.5, delay: Math.min(i, 10) * 0.045, ease: [0.2, 0.8, 0.2, 1] });
      } catch (e) { el.style.opacity = ''; }
    });
    if (queue.length) raf = requestAnimationFrame(flush);
  }
  function take(el) {
    if (seen.has(el) || el.closest('[aria-hidden="true"]') || el.hasAttribute('hidden')) return;
    if (el.style && el.style.opacity) return;
    seen.add(el);
    el.style.opacity = '0';
    queue.push(el);
    if (!raf) raf = requestAnimationFrame(flush);
  }
  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.matches && root.matches(SEL)) take(root);
    var list = root.querySelectorAll ? root.querySelectorAll(SEL) : [];
    for (var i = 0; i < list.length; i++) take(list[i]);
  }

  // Bilah kemajuan tipis saat pindah halaman.
  var bar = document.createElement('div');
  bar.id = 'ail-progress';
  bar.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bar);
  function route() {
    try {
      animate(bar, { opacity: [1, 1, 0], scale: [0.05, 0.7, 1] }, { duration: 0.7, ease: 'easeOut' });
      var pc = document.querySelector('.page-content');
      if (pc) animate(pc, { opacity: [0.4, 1], translate: ['0 8px', '0 0'] }, { duration: 0.35, ease: 'easeOut' });
    } catch (e) {}
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);
  var last = location.pathname + location.hash;
  setInterval(function () {
    var now = location.pathname + location.hash;
    if (now !== last) { last = now; route(); }
  }, 250);

  var root = document.getElementById('root');
  if (!root) return;
  var mo = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) scan(added[j]);
    }
  });
  mo.observe(root, { childList: true, subtree: true });
  scan(root);
})();
