/**
 * Carrega os modelos .glb do palco, dois por vez, começando pelos mais perto do console escolhido.
 * Cada arquivo é "arrumado" na hora (sem alterar o arquivo): tira chão/sombra que vem junto, esconde
 * peças que não são o console, corrige materiais transparentes e normaliza o tamanho.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONSOLES, stageSize, type StageConsole } from './consoles';

export interface StageModel { object: THREE.Object3D; mixer: THREE.AnimationMixer | null }

const loader = new GLTFLoader();
const cache = new Map<string, Promise<StageModel>>();
const waiting = new Map<string, { resolve: (m: StageModel) => void; reject: (e: unknown) => void; tries: number }>();
let active = 0;
let focusIdx = 0;

/** Avisa qual console está selecionado (muda a prioridade da fila). */
export const setModelFocus = (i: number) => { focusIdx = i; };

const dist = (id: string) => {
  const n = CONSOLES.length, i = CONSOLES.findIndex(c => c.id === id);
  return Math.min((i - focusIdx + n) % n, (focusIdx - i + n) % n);
};

function pump() {
  while (active < 2 && waiting.size) {
    const id = [...waiting.keys()].sort((a, b) => dist(a) - dist(b))[0]!;
    const job = waiting.get(id)!; waiting.delete(id);
    const c = CONSOLES.find(x => x.id === id)!;
    active++;
    loadNow(c).then(job.resolve, e => {
      if (++job.tries < 3) setTimeout(() => { waiting.set(id, job); pump(); }, 1500 * job.tries);
      else job.reject(e);
    }).finally(() => { active--; pump(); });
  }
}

export function loadStageModel(c: StageConsole): Promise<StageModel> {
  let p = cache.get(c.id);
  if (!p) {
    p = new Promise((resolve, reject) => { waiting.set(c.id, { resolve, reject, tries: 0 }); });
    cache.set(c.id, p);
    queueMicrotask(pump);
  }
  return p;
}

async function loadNow(c: StageConsole): Promise<StageModel> {
  const [file, rotY, tiltX, emissive, minRough] = c.model;
  const res = await loader.loadAsync(`models/${file}`);
  const o = res.scene; o.updateMatrixWorld(true);
  const size = new THREE.Vector3();

  // chão/sombra que vem junto do arquivo
  const junk: THREE.Object3D[] = [];
  o.traverse(x => {
    if (!(x as THREE.Mesh).isMesh) return;
    const m = x as THREE.Mesh, mt = m.material as THREE.Material;
    if (/ground|floor|shadow|backdrop/i.test(m.name) || (mt?.transparent && new THREE.Box3().setFromObject(m).getSize(size).y < 1e-4)) junk.push(m);
  });
  junk.forEach(x => x.removeFromParent());

  if (c.hide) {
    const rm: THREE.Object3D[] = [];
    o.traverse(x => { const m = x as THREE.Mesh; if (m.isMesh && (c.hide!.test(m.name) || c.hide!.test((m.material as THREE.Material)?.name ?? ''))) rm.push(m); });
    rm.forEach(x => x.removeFromParent());
  }

  // Alguns exports marcam tudo como semitransparente: a ordem de desenho quebra e peças internas aparecem
  // através da carcaça. Peças opacas viram corte por alfa; "Invisible" some.
  o.traverse(x => {
    const m = x as THREE.Mesh; if (!m.isMesh) return;
    const ms = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
    if (ms.some(mt => /invisible/i.test(mt.name))) { m.visible = false; return; }
    for (const mt of ms) {
      if (emissive !== undefined && mt.emissiveMap) mt.emissiveIntensity = emissive;
      if (minRough !== undefined && 'roughness' in mt) { mt.roughnessMap = null; mt.roughness = Math.max(mt.roughness, minRough); mt.metalness = Math.min(mt.metalness, 0.3); mt.needsUpdate = true; }
      if (mt.transparent && !/glass|vidro|clear|lens|scheibe/i.test(mt.name)) { mt.transparent = false; mt.depthWrite = true; mt.alphaTest = 0.5; mt.needsUpdate = true; }
    }
    m.frustumCulled = false;
  });

  o.rotation.set(tiltX, rotY, 0);
  const inner = new THREE.Group(); inner.add(o);
  let b = new THREE.Box3().setFromObject(inner); b.getSize(size);
  const flat = size.y / Math.max(size.x, size.z) < 0.3;
  inner.scale.setScalar(stageSize(c.cm, flat) / Math.max(size.x, size.y, size.z));
  b = new THREE.Box3().setFromObject(inner); const ct = b.getCenter(new THREE.Vector3());
  inner.position.set(-ct.x, -b.min.y, -ct.z);

  // ex.: a tela do fliperama com o Pac-Man
  let mixer: THREE.AnimationMixer | null = null;
  if (res.animations?.length) { mixer = new THREE.AnimationMixer(o); res.animations.forEach(a => mixer!.clipAction(a).play()); }
  return { object: inner, mixer };
}
