/* AIL LABS — Motion Glass + AI neural mesh. Vanilla JS, no dependencies, presentation only. */
(function () {
  'use strict';
  var root = document.getElementById('ail-domus');
  if (!root) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var small = window.matchMedia('(max-width: 639px)').matches;

  /* 1. Aurora orbs */
  var aurora = document.createElement('div');
  aurora.className = 'mg-aurora';
  aurora.setAttribute('aria-hidden', 'true');
  aurora.innerHTML = '<i class="mg-orb o1"></i><i class="mg-orb o2"></i><i class="mg-orb o3"></i>';
  root.insertBefore(aurora, root.firstChild);

  /* 2. Header turns denser glass after scrolling */
  var header = root.querySelector('.site-header');
  if (header) {
    var tick = false;
    var onScroll = function () {
      if (tick) return;
      tick = true;
      requestAnimationFrame(function () {
        header.classList.toggle('mg-scrolled', window.scrollY > 12);
        tick = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* 3. Pointer-following glare on glass surfaces (lazy layer injection, event delegation) */
  var SEL = '.category,.feature,.step,.compliance-card,.stat,.about-aside,.cta,.hero-panel,.panel-card,article[data-product]';
  var active = null, raf = 0, px = 0, py = 0;
  function arm(el) {
    if (el.querySelector(':scope > .mg-glare')) return;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    var g = document.createElement('span');
    g.className = 'mg-glare';
    g.setAttribute('aria-hidden', 'true');
    el.appendChild(g);
  }
  function paint() {
    raf = 0;
    if (!active) return;
    var r = active.getBoundingClientRect();
    var x = ((px - r.left) / r.width) * 100, y = ((py - r.top) / r.height) * 100;
    active.style.setProperty('--mg-x', x.toFixed(1) + '%');
    active.style.setProperty('--mg-y', y.toFixed(1) + '%');
    active.style.setProperty('--mg-sx', (x * 0.9).toFixed(1));
  }
  if (!reduce && canHover) {
    document.addEventListener('pointerover', function (e) {
      var el = e.target.closest && e.target.closest(SEL);
      if (!el || el === active) return;
      if (active) active.classList.remove('mg-lit');
      active = el;
      arm(el);
      el.classList.add('mg-lit');
    }, { passive: true });
    document.addEventListener('pointermove', function (e) {
      if (!active) return;
      px = e.clientX; py = e.clientY;
      if (!raf) raf = requestAnimationFrame(paint);
    }, { passive: true });
    document.addEventListener('pointerout', function (e) {
      if (active && !active.contains(e.relatedTarget)) { active.classList.remove('mg-lit'); active = null; }
    }, { passive: true });
  }

  /* 4. Scroll reveal for below-the-fold blocks only (nothing hides above the fold, so no flash) */
  if (!reduce && 'IntersectionObserver' in window) {
    var groups = root.querySelectorAll('.section-head,.category-grid>*,.feature,.step,.compliance-card,.about-copy,.about-aside,.cta,.contact-grid>*,.stat');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    var vh = window.innerHeight;
    Array.prototype.forEach.call(groups, function (el) {
      if (el.closest('[hidden]') || el.getBoundingClientRect().top < vh * 0.92) return;
      var sib = el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : 0;
      el.style.setProperty('--mg-i', Math.min(sib, 6));
      el.classList.add('mg-reveal');
      io.observe(el);
    });
  }

  /* 5. AI neural mesh behind the hero: drifting nodes, links that light up near the pointer */
  var hero = root.querySelector('.hero');
  if (!hero) return;
  var cv = document.createElement('canvas');
  cv.className = 'mg-neural';
  cv.setAttribute('aria-hidden', 'true');
  hero.insertBefore(cv, hero.firstChild);
  var ctx = cv.getContext('2d');
  if (!ctx) return;
  var W = 0, H = 0, dpr = 1, nodes = [], visible = true, running = false, mouse = { x: -999, y: -999 };
  var LINK = small ? 110 : 150, N = small ? 26 : 52;

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = hero.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var want = Math.round(N * Math.min(1.6, (W * H) / (1200 * 700)));
    want = Math.max(16, want);
    while (nodes.length < want) nodes.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 0.28, vy: (Math.random() - 0.5) * 0.28, o: Math.random() < 0.18 });
    nodes.length = want;
  }
  function frame() {
    ctx.clearRect(0, 0, W, H);
    var i, j, a, b, dx, dy, d, t;
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      if (!reduce) {
        a.x += a.vx; a.y += a.vy;
        if (a.x < 0 || a.x > W) a.vx *= -1;
        if (a.y < 0 || a.y > H) a.vy *= -1;
      }
      for (j = i + 1; j < nodes.length; j++) {
        b = nodes[j]; dx = a.x - b.x; dy = a.y - b.y; d = dx * dx + dy * dy;
        if (d < LINK * LINK) {
          t = 1 - Math.sqrt(d) / LINK;
          ctx.strokeStyle = 'rgba(10,167,181,' + (t * 0.32).toFixed(3) + ')';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      dx = a.x - mouse.x; dy = a.y - mouse.y; d = Math.sqrt(dx * dx + dy * dy);
      if (d < 170) {
        t = 1 - d / 170;
        ctx.strokeStyle = 'rgba(240,123,79,' + (t * 0.5).toFixed(3) + ')';
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
      }
      ctx.fillStyle = a.o ? 'rgba(240,123,79,.85)' : 'rgba(8,112,121,.7)';
      ctx.beginPath(); ctx.arc(a.x, a.y, a.o ? 2.6 : 1.8, 0, 6.2832); ctx.fill();
    }
    if (!reduce && visible && !document.hidden) requestAnimationFrame(frame); else running = false;
  }
  function start() { if (running) return; running = true; requestAnimationFrame(frame); }

  size();
  frame();                       /* first frame (static when reduced motion) */
  requestAnimationFrame(function () { cv.classList.add('is-on'); });
  if (reduce) return;
  running = true;
  window.addEventListener('resize', function () { size(); if (!running) frame(); }, { passive: true });
  hero.addEventListener('pointermove', function (e) {
    var r = hero.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
  }, { passive: true });
  hero.addEventListener('pointerleave', function () { mouse.x = mouse.y = -999; }, { passive: true });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (en) { visible = en[0].isIntersecting; if (visible) start(); }, { threshold: 0 }).observe(hero);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) start(); });
})();
