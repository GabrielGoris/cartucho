/**
 * Palco 3D: os consoles em carrossel sobre uma mesa redonda com a linha neon,
 * cada um numa plataforma hexagonal. Portado do protótipo para React Three Fiber.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Palette } from '../lib/palettes';
import { CONSOLES, type StageConsole } from './consoles';
import { loadStageModel, setModelFocus, type StageModel } from './models';

const R = 7.2;
const STEP = (Math.PI * 2) / CONSOLES.length;
const CAM_HOME = new THREE.Vector3(0, 3.0, R + 8.8);
const CAM_ZOOM = new THREE.Vector3(0, 1.6, R + 3.2);
const LOOK = new THREE.Vector3(0, 0.6, R - 1.2);
const PAD_Y = 0.026, PAD_TOP = PAD_Y + 0.04;   // plataforma um pouco acima da linha da mesa
const RING_R = R + 1.32;

export type StageMode = 'stage' | 'behind' | 'hidden';
interface Props {
  sel: number;
  mode: StageMode;        // stage = palco em uso; behind = atrás da Home (desfocado); hidden = dentro de um console
  zoom: boolean;          // câmera chega perto (ao ligar um console)
  palette: Palette;
  pixel: boolean;         // renderiza em baixa resolução (visual retrô)
  onSelect: (i: number) => void;
  onEnter: (i: number) => void;
}

export function Stage(p: Props) {
  return (
    <div className={`stage stage-${p.mode}`} onWheel={e => { if (p.mode === 'stage') p.onSelect(p.sel + (e.deltaY > 0 ? 1 : -1)); }}>
      <Canvas
        flat
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        camera={{ fov: 36, near: 0.1, far: 80, position: CAM_HOME.toArray() }}
        frameloop={p.mode === 'hidden' ? 'never' : 'always'}
        aria-label="Consoles em 3D girando num palco"
      >
        <Scene {...p} />
      </Canvas>
    </div>
  );
}

function Scene({ sel, mode, zoom, palette: P, pixel, onSelect, onEnter }: Props) {
  const { gl, scene, camera, size, setDpr } = useThree();

  // ambiente de luz (reflexos suaves nos plásticos) + fundo e neblina na cor da paleta
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env; scene.environmentIntensity = 0.55;
    return () => { env.dispose(); pm.dispose(); };
  }, [gl, scene]);
  useEffect(() => { scene.background = new THREE.Color(P.bg); scene.fog = new THREE.Fog(P.bg, 12, 26); }, [scene, P.bg]);

  // baixa resolução de propósito: ~520 px de largura, ampliados sem suavizar (CSS pixelated)
  useEffect(() => { setDpr(pixel ? Math.min(1, 520 / Math.max(1, size.width)) : Math.min(2, window.devicePixelRatio || 1)); }, [pixel, size.width, setDpr]);
  // o modelo sobe um pouco na tela, deixando a parte de baixo para o nome
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera, w = size.width, h = size.height;
    cam.fov = w / h < 1.2 ? 50 : 36;
    cam.setViewOffset(w, h, 0, h * 0.13, w, h);
    cam.updateProjectionMatrix();
  }, [camera, size.width, size.height]);

  const spot = useRef<THREE.SpotLight>(null!), rim = useRef<THREE.PointLight>(null!);
  const spotTarget = useMemo(() => { const o = new THREE.Object3D(); o.position.set(0, 0, R); return o; }, []);
  useEffect(() => {
    const col = new THREE.Color(CONSOLES[sel]!.color);
    spot.current.color.copy(col).lerp(new THREE.Color(0xffffff), 0.55);
    rim.current.color.copy(col);
  }, [sel]);

  return (
    <>
      <hemisphereLight args={[0x9a8cff, 0x140a24, 1.1]} />
      <directionalLight color={0xffe2b8} intensity={2.2} position={[3, 6, 9]} />
      <primitive object={spotTarget} />
      <spotLight ref={spot} intensity={34} distance={16} angle={Math.PI / 8} penumbra={0.5} decay={1.2} position={[0, 7, R + 0.8]} target={spotTarget} />
      <pointLight ref={rim} intensity={14} distance={8} decay={1.4} position={[0, 1.6, R - 1.6]} />

      <gridHelper key={P.id} args={[60, 60, P.pink, P.line]} position-y={-0.22} />
      <mesh position-y={-0.12}>
        <cylinderGeometry args={[R + 1.3, R + 1.4, 0.2, 64]} />
        <meshStandardMaterial color={P.panel} roughness={0.9} flatShading />
      </mesh>
      {/* linha contínua rente à mesa; as plataformas ficam por cima, então ela "entra" por baixo de cada uma */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.017}>
        <ringGeometry args={[RING_R - 0.045, RING_R + 0.045, 160]} />
        <meshBasicMaterial color={P.acc} />
      </mesh>

      <Carousel sel={sel} mode={mode} zoom={zoom} padColor={P.line} onSelect={onSelect} onEnter={onEnter} />
    </>
  );
}

function Carousel({ sel, mode, zoom, padColor, onSelect, onEnter }: { sel: number; mode: StageMode; zoom: boolean; padColor: string; onSelect: (i: number) => void; onEnter: (i: number) => void }) {
  const carousel = useRef<THREE.Group>(null!);
  const wraps = useRef<(THREE.Group | null)[]>([]);
  const mixers = useRef(new Set<THREE.AnimationMixer>());
  const anim = useRef({ rotTarget: -sel * STEP, rotNow: -sel * STEP, zoom: 0 });
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const { camera, gl } = useThree();

  // girar pelo caminho mais curto: o alvo é sempre -sel·STEP, na volta mais perto de onde já está
  useEffect(() => {
    const a = anim.current, base = -sel * STEP, TAU = Math.PI * 2;
    a.rotTarget = base + Math.round((a.rotTarget - base) / TAU) * TAU;
    setModelFocus(sel);
  }, [sel]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05), a = anim.current;
    mixers.current.forEach(m => m.update(dt));
    a.rotNow += (a.rotTarget - a.rotNow) * Math.min(1, dt * 6);
    carousel.current.rotation.y = a.rotNow;
    wraps.current.forEach((m, i) => {
      if (!m) return;
      const on = i === sel;
      if (on) m.rotation.y += dt * 0.6;
      else m.rotation.y += (Math.round(m.rotation.y / (Math.PI * 2)) * Math.PI * 2 - m.rotation.y) * Math.min(1, dt * 3);
      const s = on ? 1.0 : 0.82; m.scale.lerp(tmp.set(s, s, s), Math.min(1, dt * 6));
      const y = on ? PAD_TOP + 0.15 + Math.sin(state.clock.elapsedTime * 2) * 0.05 : PAD_TOP;
      m.position.y += (y - m.position.y) * Math.min(1, dt * 6);
    });
    a.zoom += ((zoom ? 1 : 0) - a.zoom) * Math.min(1, dt * 7);
    camera.position.lerpVectors(CAM_HOME, CAM_ZOOM, a.zoom);
    camera.lookAt(LOOK);
  });

  const click = (i: number) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (mode !== 'stage') return;
    if (i === sel) onEnter(i); else onSelect(i);
  };
  const hover = (on: boolean) => () => { if (mode === 'stage') gl.domElement.style.cursor = on ? 'pointer' : ''; };

  return (
    <group ref={carousel}>
      {CONSOLES.map((c, i) => {
        const ang = i * STEP;
        return (
          <group key={c.id} position={[Math.sin(ang) * R, 0, Math.cos(ang) * R]} rotation-y={ang} onClick={click(i)} onPointerOver={hover(true)} onPointerOut={hover(false)}>
            <group ref={el => { wraps.current[i] = el; }} position-y={PAD_TOP}>
              <ConsoleModel c={c} mixers={mixers.current} />
            </group>
            <mesh position-y={PAD_Y}>
              <cylinderGeometry args={[1.4, 1.5, 0.08, 6]} />
              <meshStandardMaterial color={padColor} roughness={0.55} metalness={0.08} flatShading />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function ConsoleModel({ c, mixers }: { c: StageConsole; mixers: Set<THREE.AnimationMixer> }) {
  const [m, setM] = useState<StageModel | null>(null);
  useEffect(() => {
    let alive = true;
    loadStageModel(c).then(x => { if (!alive) return; setM(x); if (x.mixer) mixers.add(x.mixer); }, e => console.warn(`[palco] ${c.id}:`, e));
    return () => { alive = false; };
  }, [c, mixers]);
  return m ? <primitive object={m.object} /> : null;
}
