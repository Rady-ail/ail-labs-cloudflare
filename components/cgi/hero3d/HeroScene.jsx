import { Component, useEffect, useMemo, useRef } from 'react';
import { createRoot, extend, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei/core/ContactShadows.js';
import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Points,
  RingGeometry,
  SpotLight,
} from 'three';
import { Vial } from './Vial.jsx';
import { Bokeh } from './Bokeh.jsx';
import { StudioEnvironment } from './StudioEnvironment.jsx';
import { createRadialTexture } from './labelTexture.js';
import { FLOAT_SPEED, SPIN_SPEED } from './constants.js';

// Hanya kelas yang dipakai yang didaftarkan (bukan seluruh namespace THREE) agar chunk tetap kecil.
extend({
  BoxGeometry, CylinderGeometry, DirectionalLight, Group, LatheGeometry, Mesh, MeshBasicMaterial,
  MeshPhysicalMaterial, MeshStandardMaterial, OrthographicCamera, PlaneGeometry, Points, RingGeometry, SpotLight,
});

const clamp = (v, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v));
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));

class SceneBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    setTimeout(() => this.props.onError(error), 0);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Backdrop({ high }) {
  const [bg, halo] = useMemo(
    () => [
      createRadialTexture([[0, '#24585A'], [0.5, '#123334'], [1, '#071718']], 512),
      createRadialTexture([[0, 'rgba(240,210,140,0.9)'], [0.35, 'rgba(240,210,140,0.25)'], [1, 'rgba(240,210,140,0)']]),
    ],
    [],
  );
  useEffect(() => () => { bg.dispose(); halo.dispose(); }, [bg, halo]);
  return (
    <>
      <mesh position={[0, 0.3, -7]} layers={1}>
        <planeGeometry args={[24, 14]} />
        <meshBasicMaterial map={bg} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.35, -1.2]} layers={1}>
        <planeGeometry args={[4.2, 4.2]} />
        <meshBasicMaterial map={halo} transparent opacity={high ? 0.5 : 0.36} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
    </>
  );
}

function Scene({ tier, input, onCompiled, onFirstFrame }) {
  const high = tier === 'high';
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const rig = useRef(null);
  const floater = useRef(null);
  const spinner = useRef(null);
  const clock = useRef(0);
  const frames = useRef(0);

  useEffect(() => {
    camera.layers.enable(1);
    camera.lookAt(0, 0.2, 0);
    gl.transmissionResolutionScale = high ? 1 : 0.5;
    let alive = true;
    const done = () => { if (alive) onCompiled(); };
    // Kompilasi shader paralel bila didukung, supaya tidak ada long task di main thread.
    if (gl.extensions.has('KHR_parallel_shader_compile')) gl.compileAsync(scene, camera).then(done, done);
    else done();
    return () => { alive = false; };
  }, [gl, scene, camera, high, onCompiled]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const t = (clock.current += dt);
    floater.current.position.y = Math.sin(t * FLOAT_SPEED) * 0.07;
    spinner.current.rotation.y = t * SPIN_SPEED;
    const ry = clamp(input.px + input.gx) * 0.35 + input.scroll * 0.6;
    const rx = clamp(input.py + input.gy) * 0.1;
    rig.current.rotation.y = damp(rig.current.rotation.y, ry, 3, dt);
    rig.current.rotation.x = damp(rig.current.rotation.x, rx, 3, dt);
    if (++frames.current === 2) onFirstFrame();
  });

  return (
    <>
      <StudioEnvironment />
      <Backdrop high={high} />
      <directionalLight position={[2.5, 3, 3]} intensity={0.8} color="#FFF6E6" />
      <spotLight position={[-2.6, 2.2, -2.8]} angle={0.55} penumbra={1} intensity={34} decay={2} color="#F0D28C" />
      <spotLight position={[2.8, 1.2, -2.4]} angle={0.5} penumbra={1} intensity={18} decay={2} color="#E7C98E" />
      <group ref={rig}>
        <group ref={floater}>
          <group ref={spinner}>
            <Vial high={high} anisotropy={high ? 8 : 4} />
          </group>
        </group>
      </group>
      <ContactShadows position={[0, -1.08, 0]} scale={4} far={2.4} blur={2.6} opacity={0.6} resolution={high ? 512 : 256} frames={1} color="#020C0B" />
      <Bokeh count={high ? 120 : 60} clock={clock} />
    </>
  );
}

// Mount scene ke canvas yang disediakan HeroStage. Mengembalikan { dispose }.
export function mountHero(canvas, { tier, strict = true, onReady, onError }) {
  const high = tier === 'high';
  const host = canvas.parentElement;
  const input = { px: 0, py: 0, gx: 0, gy: 0, scroll: 0 };
  const coarse = matchMedia('(pointer: coarse)').matches;
  let root = null;
  let store = null;
  let compiled = false;
  let inView = true;
  let disposed = false;
  let readySent = false;

  const measure = () => {
    const r = host.getBoundingClientRect();
    return { width: Math.max(1, r.width), height: Math.max(1, r.height), top: 0, left: 0 };
  };
  const sync = () => {
    if (store && !disposed) store.setFrameloop(compiled && inView && !document.hidden ? 'always' : 'never');
  };
  const onPointer = (e) => {
    input.px = (e.clientX / innerWidth) * 2 - 1;
    input.py = (e.clientY / innerHeight) * 2 - 1;
  };
  const onScroll = () => { input.scroll = clamp(scrollY / Math.max(1, innerHeight), 0, 1); };
  const onOrientation = (e) => {
    if (e.gamma == null || e.beta == null) return;
    input.gx = clamp(e.gamma / 35);
    input.gy = clamp((e.beta - 40) / 35);
  };
  const onContextLost = (e) => { e.preventDefault(); fail(new Error('WebGL context lost')); };

  const ro = new ResizeObserver(() => {
    if (!store) return;
    const s = measure();
    store.setSize(s.width, s.height);
  });
  const io = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; sync(); });

  function dispose() {
    if (disposed) return;
    disposed = true;
    ro.disconnect();
    io.disconnect();
    document.removeEventListener('visibilitychange', sync);
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('deviceorientation', onOrientation);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    if (root) root.unmount();
    root = null;
    store = null;
  }
  function fail(err) {
    if (disposed) return;
    dispose();
    onError(err);
  }

  ro.observe(host);
  io.observe(host);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('scroll', onScroll, { passive: true });
  if (coarse) window.addEventListener('deviceorientation', onOrientation, { passive: true });
  else window.addEventListener('pointermove', onPointer, { passive: true });
  canvas.addEventListener('webglcontextlost', onContextLost);
  onScroll();

  try {
    root = createRoot(canvas);
    root
      .configure({
        gl: {
          antialias: high,
          alpha: true,
          stencil: false,
          powerPreference: 'high-performance',
          failIfMajorPerformanceCaveat: strict,
        },
        dpr: [1, high ? 1.5 : 1.25],
        size: measure(),
        frameloop: 'never',
        camera: { fov: 30, near: 0.1, far: 40, position: [0, 0.3, 6.4] },
        onCreated: (state) => { store = state; },
      })
      .then(() => {
        if (disposed) return;
        root.render(
          <SceneBoundary onError={fail}>
            <Scene
              tier={tier}
              input={input}
              onCompiled={() => { compiled = true; sync(); }}
              onFirstFrame={() => {
                if (readySent || disposed) return;
                readySent = true;
                onReady();
              }}
            />
          </SceneBoundary>,
        );
      })
      .catch(fail);
  } catch (err) {
    setTimeout(() => fail(err), 0);
  }

  return { dispose };
}
