// Deteksi kemampuan perangkat untuk efek CGI. Hasil di-cache per halaman.
const TIERS = ['low', 'medium', 'high'];
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

let cachedTier = null;

// ?cgi-tier=low|medium|high memaksa tier (untuk uji/QA).
export function tierOverride() {
  try {
    const t = new URLSearchParams(location.search).get('cgi-tier');
    return TIERS.includes(t) ? t : null;
  } catch {
    return null;
  }
}

export function detectTier() {
  if (cachedTier) return cachedTier;
  cachedTier = tierOverride() || measureTier();
  return cachedTier;
}

function measureTier() {
  const nav = navigator;
  const conn = nav.connection || {};
  if (conn.saveData || /2g/.test(conn.effectiveType || '')) return 'low';
  const coarse = matchMedia('(pointer: coarse)').matches;
  const cores = nav.hardwareConcurrency || 4;
  const mem = nav.deviceMemory || (coarse ? 4 : 8);
  if (mem <= 2 || cores <= 2 || (coarse && mem < 4 && cores <= 4)) return 'low';
  if (!coarse && mem >= 8 && cores >= 8) return 'high';
  return 'medium';
}

export function prefersReducedMotion() {
  return matchMedia(REDUCED_MOTION_QUERY).matches;
}

// three.js modern butuh WebGL2. strict = tolak renderer software (SwiftShader dsb.).
export function supportsWebGL2(strict = true) {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: strict });
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  } catch {
    return false;
  }
}
