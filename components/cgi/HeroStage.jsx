import * as React from 'react';
import { detectTier, tierOverride, supportsWebGL2, REDUCED_MOTION_QUERY } from './tier.js';
import { HERO_MEDIA } from './media.js';

const { useEffect, useRef, useState, useSyncExternalStore } = React;

// Disuntik oleh scripts/build-cgi.mjs (nama file ber-hash chunk 3D).
const HERO3D_URL = __CGI_HERO3D_URL__;

function subscribeReducedMotion(onChange) {
  const mq = matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

export function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => matchMedia(REDUCED_MOTION_QUERY).matches,
    () => true,
  );
}

function hasVideo() {
  const conn = navigator.connection || {};
  return !!(HERO_MEDIA.webm || HERO_MEDIA.mp4) && !conn.saveData;
}

// Jalankan fn setelah halaman load + browser idle, supaya 3D tidak bersaing dengan render awal.
function afterInteractive(fn) {
  let cancelled = false;
  let idleId = 0;
  let timerId = 0;
  const run = () => {
    if (cancelled) return;
    if ('requestIdleCallback' in window) idleId = requestIdleCallback(fn, { timeout: 2500 });
    else timerId = setTimeout(fn, 600);
  };
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener('load', run);
    if (idleId) cancelIdleCallback(idleId);
    clearTimeout(timerId);
  };
}

// Lapisan media hero di atas poster statis: canvas 3D (tier sedang/tinggi), video loop
// bila WebGL tidak tersedia, atau tidak ada apa-apa (poster saja) untuk tier rendah/reduced-motion.
export function HeroStage() {
  const reduced = useReducedMotion();
  const [tier] = useState(detectTier);
  const [mode, setMode] = useState('poster');
  const [ready, setReady] = useState(false);
  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const animated = !reduced && tier !== 'low';

  useEffect(() => {
    setReady(false);
    if (!animated) {
      setMode('poster');
      return undefined;
    }
    return afterInteractive(() => {
      const strict = !tierOverride();
      setMode(supportsWebGL2(strict) ? 'canvas' : hasVideo() ? 'video' : 'poster');
    });
  }, [animated]);

  useEffect(() => {
    if (mode !== 'canvas') return undefined;
    let cancelled = false;
    let handle = null;
    const fallback = (err) => {
      if (cancelled) return;
      console.info('[cgi] hero 3D dimatikan, memakai fallback:', (err && err.message) || err);
      setReady(false);
      setMode(hasVideo() ? 'video' : 'poster');
    };
    import(HERO3D_URL)
      .then((m) => {
        if (cancelled || !canvasRef.current) return;
        handle = m.mountHero(canvasRef.current, {
          tier,
          strict: !tierOverride(),
          onReady: () => { if (!cancelled) setReady(true); },
          onError: fallback,
        });
      })
      .catch(fallback);
    return () => {
      cancelled = true;
      if (handle) handle.dispose();
    };
  }, [mode, tier]);

  useEffect(() => {
    const video = videoRef.current;
    if (mode !== 'video' || !video) return undefined;
    let inView = false;
    const sync = () => {
      if (inView && !document.hidden) video.play().catch(() => {});
      else video.pause();
    };
    const io = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; sync(); });
    io.observe(video);
    document.addEventListener('visibilitychange', sync);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', sync);
      video.pause();
    };
  }, [mode]);

  const className = 'cgi-stage__media' + (ready ? ' is-ready' : '');
  if (mode === 'canvas') {
    return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
  }
  if (mode === 'video') {
    const toPoster = () => { setReady(false); setMode('poster'); };
    return (
      <video
        ref={videoRef}
        className={className}
        muted
        playsInline
        loop
        preload="auto"
        disablePictureInPicture
        aria-hidden="true"
        tabIndex={-1}
        onLoadedData={() => setReady(true)}
        onError={toPoster}
      >
        {HERO_MEDIA.webm && <source src={HERO_MEDIA.webm} type="video/webm" />}
        {HERO_MEDIA.mp4 && <source src={HERO_MEDIA.mp4} type="video/mp4" onError={toPoster} />}
      </video>
    );
  }
  return null;
}
