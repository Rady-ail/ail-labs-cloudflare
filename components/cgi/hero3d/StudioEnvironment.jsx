import { useLayoutEffect, useState } from 'react';
import { Color, PMREMGenerator, Scene } from 'three';
import { createPortal, useThree } from '@react-three/fiber';
import { Lightformer } from '@react-three/drei/core/Lightformer.js';

// Studio virtual dari Lightformer -> PMREM sekali saja (tanpa unduh HDR).
export function StudioEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const [studio] = useState(() => {
    const s = new Scene();
    s.background = new Color('#0B2324');
    return s;
  });

  useLayoutEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const target = pmrem.fromScene(studio, 0.03);
    scene.environment = target.texture;
    return () => {
      scene.environment = null;
      target.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, studio]);

  return createPortal(
    <>
      <Lightformer form="rect" intensity={2.2} color="#FFF8EC" position={[0, 4.5, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[7, 2.5, 1]} />
      <Lightformer form="rect" intensity={3} color="#FFFFFF" position={[-4, 0.6, 1]} rotation={[0, Math.PI / 2, 0]} scale={[0.7, 6, 1]} />
      <Lightformer form="rect" intensity={2.6} color="#F0D28C" position={[4, 0.4, -1]} rotation={[0, -Math.PI / 2, 0]} scale={[0.9, 6, 1]} />
      <Lightformer form="ring" intensity={1.6} color="#E7C98E" position={[0, 0.6, -6]} scale={3} />
      <Lightformer form="rect" intensity={0.5} color="#9FD1C2" position={[0, -0.5, 6]} rotation={[0, Math.PI, 0]} scale={[6, 3, 1]} />
    </>,
    studio,
  );
}
