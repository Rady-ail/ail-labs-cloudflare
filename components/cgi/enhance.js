import { detectTier, prefersReducedMotion } from './tier.js';

// Efek DOM progresif di atas UI yang sudah ada. Tier rendah: tidak ada efek (statis).
let started = false;

export function enhance() {
  if (started) return;
  started = true;
  const tier = detectTier();
  document.documentElement.dataset.cgiTier = tier;
  if (tier === 'low') return;
  const root = document.getElementById('root');
  startParallax();
  startReveal(root);
  startTilt(root);
}

// Parallax latar: geser lapisan .cgi-backdrop__drift pelan mengikuti scroll (rAF, passive).
function startParallax() {
  const drift = document.querySelector('.cgi-backdrop__drift');
  if (!drift) return;
  let raf = 0;
  const apply = () => {
    raf = 0;
    const y = prefersReducedMotion() ? 0 : Math.min(scrollY, 2400) * -0.05;
    drift.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
  };
  window.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(apply); }, { passive: true });
  apply();
}

// Reveal bertahap: elemen di bawah layar muncul halus saat masuk viewport.
// Elemen yang sudah terlihat saat dipindai tidak pernah disembunyikan.
const REVEAL_SELECTOR = '#productGroups .section-block, .info-card, .contact-card, .cart-summary';
const REVEAL_STAGGER_MS = 70;

function startReveal(root) {
  if (!root || !('IntersectionObserver' in window)) return;
  const seen = new WeakSet();
  const io = new IntersectionObserver((entries) => {
    let i = 0;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      el.style.transitionDelay = `${Math.min(i++, 4) * REVEAL_STAGGER_MS}ms`;
      el.classList.add('cgi-reveal-in');
      io.unobserve(el);
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });

  let raf = 0;
  const scan = () => {
    raf = 0;
    const reduced = prefersReducedMotion();
    for (const el of root.querySelectorAll(REVEAL_SELECTOR)) {
      if (seen.has(el) || el.offsetParent === null) continue;
      seen.add(el);
      if (reduced || el.getBoundingClientRect().top < innerHeight) continue;
      el.classList.add('cgi-reveal');
      io.observe(el);
    }
  };
  new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(scan); })
    .observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  scan();
}

// Tilt 3D (maks 6 derajat) + kilau specular mengikuti pointer, hanya mouse/pen pada perangkat hover.
const TILT_SELECTOR = '.row, .cart-row';
const TILT_MAX_DEG = 6;

function startTilt(root) {
  if (!root || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  let active = null;
  let raf = 0;
  let px = 0;
  let py = 0;

  const release = () => {
    if (!active) return;
    active.classList.remove('cgi-tilt');
    active.style.removeProperty('transform');
    active = null;
  };
  const apply = () => {
    raf = 0;
    if (!active) return;
    const r = active.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (px - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (py - r.top) / r.height));
    active.style.setProperty('--cgi-mx', `${(x * 100).toFixed(1)}%`);
    active.style.setProperty('--cgi-my', `${(y * 100).toFixed(1)}%`);
    active.style.transform = `perspective(900px) rotateX(${((0.5 - y) * TILT_MAX_DEG).toFixed(2)}deg) rotateY(${((x - 0.5) * TILT_MAX_DEG).toFixed(2)}deg)`;
  };

  root.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || prefersReducedMotion()) return release();
    const el = e.target.closest(TILT_SELECTOR);
    if (el !== active) {
      release();
      if (!el) return;
      active = el;
      el.classList.add('cgi-tilt');
    }
    px = e.clientX;
    py = e.clientY;
    if (!raf) raf = requestAnimationFrame(apply);
  }, { passive: true });
  root.addEventListener('pointerleave', release);
  window.addEventListener('blur', release);
}
