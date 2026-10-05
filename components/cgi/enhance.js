import { detectTier } from './tier.js';

// Efek DOM progresif (latar, reveal, tilt) — diisi pada tahap berikutnya.
let started = false;

export function enhance() {
  if (started) return;
  started = true;
  document.documentElement.dataset.cgiTier = detectTier();
}
