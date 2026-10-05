import { useEffect, useMemo } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { LOOP_SECONDS } from './constants.js';

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uFocus;
  attribute float aSize;
  attribute float aSeed;
  attribute float aSpeed;
  varying float vAlpha;
  varying float vSoft;
  void main() {
    vec3 p = position;
    float a = uTime * aSpeed + aSeed * 6.2831853;
    p.x += sin(a) * 0.12;
    p.y += cos(a) * 0.18;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float dist = -mv.z;
    float blur = clamp(abs(dist - uFocus) / 4.0, 0.0, 1.0);
    gl_PointSize = aSize * uPixelRatio * (1.0 + blur * 2.2) * (6.0 / dist);
    vAlpha = (0.7 - blur * 0.42) * (0.75 + 0.25 * sin(a * 2.0 + aSeed * 3.0));
    vSoft = blur;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vSoft;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float disc = 1.0 - smoothstep(0.55 - vSoft * 0.35, 1.0, d);
    float rim = smoothstep(0.55, 0.92, d) * (1.0 - smoothstep(0.92, 1.0, d)) * (1.0 - vSoft);
    float a = (disc * 0.5 + rim * 0.5) * vAlpha * uOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

// Partikel bokeh emas (maks 120). DOF palsu: makin jauh dari fokus makin besar & redup.
export function Bokeh({ count, clock }) {
  const n = Math.min(count, 120);
  const pixelRatio = useThree((s) => s.viewport.dpr);
  const geometry = useMemo(() => {
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const seed = new Float32Array(n);
    const speed = new Float32Array(n);
    let s = 7;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rand() - 0.5) * 6.4;
      pos[i * 3 + 1] = -1.6 + rand() * 3.8;
      pos[i * 3 + 2] = -5 + rand() * 7;
      size[i] = 4 + rand() * 10;
      seed[i] = rand();
      speed[i] = (1 + Math.floor(rand() * 3)) * ((Math.PI * 2) / LOOP_SECONDS);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aSize', new BufferAttribute(size, 1));
    g.setAttribute('aSeed', new BufferAttribute(seed, 1));
    g.setAttribute('aSpeed', new BufferAttribute(speed, 1));
    return g;
  }, [n]);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: 1 },
          uFocus: { value: 6.4 },
          uColor: { value: new Color('#F0D28C') },
          uOpacity: { value: 0.7 },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  );
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  useFrame(() => {
    material.uniforms.uTime.value = clock.current;
    material.uniforms.uPixelRatio.value = pixelRatio;
  });

  return <points geometry={geometry} material={material} layers={1} frustumCulled={false} />;
}
