// Placeholder Tahap 1: modul 3D belum ada, wrapper harus jatuh ke fallback.
export function mountHero(canvas, { onError }) {
  setTimeout(() => onError(new Error('hero 3D belum tersedia')), 0);
  return { dispose() {} };
}
