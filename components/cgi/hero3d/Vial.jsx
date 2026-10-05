import { useEffect, useMemo } from 'react';
import { Vector2 } from 'three';
import { createLabelTexture } from './labelTexture.js';

// Profil lathe (x = radius, y = tinggi). Dasar vial di y = -1.
function glassProfile() {
  const R = 0.55;
  const r = 0.07;
  const pts = [new Vector2(0.0001, -1), new Vector2(R - r, -1)];
  for (let i = 1; i <= 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
    pts.push(new Vector2(R - r + Math.cos(a) * r, -1 + r + Math.sin(a) * r));
  }
  pts.push(new Vector2(R, 0.48));
  for (let i = 1; i <= 12; i++) {
    const t = i / 12;
    const x = (1 - t) * (1 - t) * R + 2 * (1 - t) * t * R + t * t * 0.22;
    const y = (1 - t) * (1 - t) * 0.48 + 2 * (1 - t) * t * 0.77 + t * t * 0.82;
    pts.push(new Vector2(x, y));
  }
  pts.push(new Vector2(0.21, 0.87), new Vector2(0.21, 1.04));
  return pts;
}

function liquidProfile() {
  const R = 0.505;
  const r = 0.06;
  const bottom = -0.955;
  const pts = [new Vector2(0.0001, bottom), new Vector2(R - r, bottom)];
  for (let i = 1; i <= 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * (Math.PI / 2);
    pts.push(new Vector2(R - r + Math.cos(a) * r, bottom + r + Math.sin(a) * r));
  }
  pts.push(new Vector2(R, 0.2), new Vector2(R - 0.02, 0.225), new Vector2(0.0001, 0.225));
  return pts;
}

const GLASS = glassProfile();
const LIQUID = liquidProfile();

export function Vial({ high, anisotropy }) {
  const seg = high ? 96 : 64;
  const label = useMemo(() => createLabelTexture(anisotropy), [anisotropy]);
  useEffect(() => () => label.dispose(), [label]);

  return (
    <group>
      <mesh renderOrder={2}>
        <latheGeometry args={[GLASS, seg]} />
        <meshPhysicalMaterial
          color="#ffffff"
          transmission={1}
          thickness={0.45}
          ior={1.5}
          roughness={0.05}
          clearcoat={1}
          clearcoatRoughness={0.06}
          attenuationColor="#CFE6D6"
          attenuationDistance={2.4}
          specularIntensity={1}
          envMapIntensity={1.5}
        />
      </mesh>
      <mesh>
        <latheGeometry args={[LIQUID, seg / 2]} />
        <meshPhysicalMaterial
          color="#D8C27E"
          roughness={0.18}
          clearcoat={0.6}
          sheen={0.6}
          sheenColor="#F0D28C"
          emissive="#5A4A1E"
          emissiveIntensity={0.35}
        />
      </mesh>
      <mesh position={[0, -0.2, 0]}>
        <cylinderGeometry args={[0.556, 0.556, 0.8, seg, 1, true, -1.1, 2.2]} />
        <meshPhysicalMaterial map={label} roughness={0.55} clearcoat={0.3} />
      </mesh>
      <mesh position={[0, 1.035, 0]}>
        <cylinderGeometry args={[0.232, 0.232, 0.07, seg / 2]} />
        <meshStandardMaterial color="#C9A86A" metalness={1} roughness={0.32} />
      </mesh>
      <mesh position={[0, 1.27, 0]}>
        <cylinderGeometry args={[0.25, 0.256, 0.42, seg / 2]} />
        <meshStandardMaterial color="#D9BC82" metalness={1} roughness={0.24} />
      </mesh>
      <mesh position={[0, 1.4925, 0]}>
        <cylinderGeometry args={[0.236, 0.25, 0.025, seg / 2]} />
        <meshStandardMaterial color="#E8D3A2" metalness={1} roughness={0.18} />
      </mesh>
    </group>
  );
}
