import * as THREE from 'three';
import { initials } from '../../lib/format';

export type Item = 'cart8' | 'cart16' | 'cart64' | 'cartmd' | 'cartgb' | 'cartds' | 'cd' | 'mini' | 'case';
export type Layout = 'row' | 'ring' | 'grid' | 'shelf';
export type Env = 'mode7' | 'n64' | 'stars' | 'bubbles' | 'dust' | 'bricks' | 'lines' | 'dsgrid' | 'none';
export interface ShelfCfg { low: [number, number]; aspect: number; smooth: boolean; item: Item; layout: Layout; bg: number; env: Env; texRes: number; palette?: string[] }
export interface ShelfGame { key: string; title: string; ghost: boolean; hue: number; cover?: string | null }

function quantize(x: CanvasRenderingContext2D, w: number, h: number, pal: string[]) {
  const rgb = pal.map(c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)] as const);
  const d = x.getImageData(0, 0, w, h);
  for (let i = 0; i < d.data.length; i += 4) {
    const l = d.data[i]! * 0.3 + d.data[i + 1]! * 0.59 + d.data[i + 2]! * 0.11;
    const c = rgb[Math.min(rgb.length - 1, Math.floor((l / 256) * rgb.length))]!;
    d.data[i] = c[0]; d.data[i + 1] = c[1]; d.data[i + 2] = c[2];
  }
  x.putImageData(d, 0, 0);
}

function label(g: ShelfGame, s: number, img: HTMLImageElement | null, pal?: string[]) {
  const c = document.createElement('canvas'); c.width = s; c.height = Math.round(s * 0.66);
  const x = c.getContext('2d', { willReadFrequently: !!pal })!, w = c.width, h = c.height;
  if (img) {
    const r = Math.max(w / img.width, h / img.height), iw = img.width * r, ih = img.height * r;
    x.imageSmoothingEnabled = true; x.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
  } else {
    const gr = x.createLinearGradient(0, 0, w * 0.5, h);
    gr.addColorStop(0, `hsl(${g.hue} 72% 56%)`); gr.addColorStop(1, `hsl(${(g.hue + 40) % 360} 65% 24%)`);
    x.fillStyle = gr; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(255,255,255,.14)'; x.lineWidth = Math.max(1, s / 64);
    for (let i = -h; i < w; i += s / 8) { x.beginPath(); x.moveTo(i, h); x.lineTo(i + h, 0); x.stroke(); }
    x.fillStyle = 'rgba(0,0,0,.4)'; x.fillRect(0, h * 0.68, w, h * 0.32);
    x.fillStyle = '#fff'; x.textBaseline = 'top';
    x.font = `${Math.round(h * 0.3)}px "Press Start 2P"`; x.fillText(initials(g.title) || '?', w * 0.07, h * 0.1);
    x.font = `${Math.max(6, Math.round(h * 0.085))}px "Press Start 2P"`;
    let line = '', y = h * 0.73; const lh = h * 0.12;
    for (const wd of g.title.toUpperCase().split(' ')) {
      if (x.measureText(line + wd).width > w * 0.88 && line) { x.fillText(line, w * 0.06, y); y += lh; line = ''; }
      line += wd + ' ';
    }
    if (y < h) x.fillText(line, w * 0.06, y);
  }
  if (pal) quantize(x, w, h, pal);
  return c;
}

function buildItem(cfg: ShelfCfg, g: ShelfGame, img: HTMLImageElement | null) {
  const G = new THREE.Group(), ghost = g.ghost;
  const tex = () => {
    const t = new THREE.CanvasTexture(label(g, cfg.texRes, img, cfg.palette)); t.colorSpace = THREE.SRGBColorSpace;
    if (!cfg.smooth) { t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; }
    return t;
  };
  const M = (c: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.1, flatShading: true, transparent: ghost, opacity: ghost ? 0.32 : 1, ...o });
  const lab = (w: number, h: number, z: number, y = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex(), transparent: ghost, opacity: ghost ? 0.4 : 1 })); m.position.set(0, y, z); G.add(m); };
  const B = (w: number, h: number, d: number, c: number, x = 0, y = 0, z = 0, o?: THREE.MeshStandardMaterialParameters) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(c, o)); m.position.set(x, y, z); G.add(m); };
  switch (cfg.item) {
    case 'cart8': B(1.08, 1.25, 0.2, 0x8d8d92); B(1.08, 0.16, 0.22, 0x6e6e74, 0, -0.55); for (let i = 0; i < 5; i++) B(0.9, 0.03, 0.21, 0x75757b, 0, 0.5 - i * 0.05); lab(0.92, 0.6, 0.101, 0.02); break;
    case 'cart16': B(1.3, 0.95, 0.24, 0x9c98a6); B(1.12, 0.12, 0.26, 0x8a8694, 0, 0.44); for (let i = 0; i < 6; i++) B(0.08, 0.06, 0.27, 0x6e6a78, -0.25 + i * 0.1, 0.44); lab(1.04, 0.62, 0.121, -0.08); break;
    case 'cart64': B(1.2, 0.9, 0.22, 0x5a5a66); B(1.32, 0.28, 0.24, 0x4a4a55, 0, 0.38); lab(0.96, 0.58, 0.111, -0.1); break;
    case 'cartmd': B(1.1, 1.3, 0.22, 0x17171b); B(1.16, 0.22, 0.24, 0x0f0f12, 0, 0.55); for (let i = 0; i < 4; i++) B(0.95, 0.025, 0.25, 0x2a2a30, 0, 0.6 - i * 0.04); lab(0.94, 0.74, 0.111, -0.12); break;
    case 'cartgb': B(0.9, 1.0, 0.16, 0x9a9aa0); B(0.9, 0.1, 0.17, 0x86868c, 0, 0.45); B(0.18, 0.18, 0.17, 0x86868c, 0.36, 0.41); lab(0.72, 0.52, 0.081, 0.02); break;
    case 'cartds': B(0.95, 1.05, 0.12, 0x3a3f48); B(0.95, 0.16, 0.13, 0x2c3038, 0, 0.45); B(0.2, 0.08, 0.13, 0x2c3038, -0.3, -0.5); lab(0.82, 0.66, 0.061, -0.02); break;
    case 'cd': case 'mini': {
      const r = cfg.item === 'cd' ? 0.62 : 0.44;
      const d = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.025, 40), M(0xdcdeea, { metalness: 0.85, roughness: 0.25, flatShading: false })); d.rotation.x = Math.PI / 2; G.add(d);
      const l = new THREE.Mesh(new THREE.CircleGeometry(r * 0.96, 40), new THREE.MeshBasicMaterial({ map: tex(), transparent: ghost, opacity: ghost ? 0.4 : 1 })); l.position.z = 0.014; G.add(l);
      const hole = new THREE.Mesh(new THREE.CircleGeometry(r * 0.14, 24), new THREE.MeshBasicMaterial({ color: 0x0a0a0a })); hole.position.z = 0.015; G.add(hole);
      break;
    }
    case 'case': B(0.92, 1.28, 0.12, 0x0d0e16); lab(0.86, 1.2, 0.061); B(0.02, 1.28, 0.12, 0x2a3c8a, -0.46, 0, 0, { emissive: new THREE.Color(0x2a3c8a), emissiveIntensity: 0.5 }); break;
  }
  return G;
}

function envFor(cfg: ShelfCfg, sc: THREE.Scene) {
  const anim: ((dt: number, t: number) => void)[] = [];
  const checker = (a: string, b: string, n: number, rep: number) => {
    const c = document.createElement('canvas'); c.width = c.height = n * 4; const x = c.getContext('2d')!;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? a : b; x.fillRect(i * n, j * n, n, n); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    return t;
  };
  if (cfg.env === 'mode7' || cfg.env === 'bricks') {
    const t = cfg.env === 'mode7' ? checker('#5a3cc8', '#2a1a78', 8, 30) : checker('#7a1f1f', '#2a2a2a', 8, 34);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshBasicMaterial({ map: t })); f.rotation.x = -Math.PI / 2; f.position.y = -0.85; sc.add(f);
    anim.push((_dt, tt) => { if (cfg.env === 'mode7') f.rotation.z = tt * 0.05; else t.offset.y = -tt * 0.05; });
  } else if (cfg.env === 'n64') {
    const c = document.createElement('canvas'); c.width = c.height = 16; const x = c.getContext('2d')!;
    x.fillStyle = '#1f6a3a'; x.fillRect(0, 0, 16, 16); x.fillStyle = '#2f8a4a'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(24, 24);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshLambertMaterial({ map: t })); f.rotation.x = -Math.PI / 2; f.position.y = -0.85; sc.add(f);
    sc.add(new THREE.Mesh(new THREE.SphereGeometry(30, 16, 8), new THREE.MeshBasicMaterial({ color: 0x3a7ad8, side: THREE.BackSide, fog: false })));
    for (let i = 0; i < 9; i++) {
      const cl = new THREE.Mesh(new THREE.IcosahedronGeometry(1 + Math.random(), 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, fog: false, emissive: 0x8899bb }));
      cl.position.set(-14 + i * 3.5, 4 + Math.random() * 3, -16 - Math.random() * 4); cl.scale.y = 0.5; sc.add(cl);
    }
  } else if (cfg.env === 'stars' || cfg.env === 'dust') {
    const n = cfg.env === 'stars' ? 500 : 700, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { p[i * 3] = (Math.random() - 0.5) * (cfg.env === 'stars' ? 30 : 20); p[i * 3 + 1] = (Math.random() - 0.5) * (cfg.env === 'stars' ? 18 : 10); p[i * 3 + 2] = -1 - Math.random() * 16; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial(cfg.env === 'stars' ? { color: 0xc7bfe0, size: 0.06 } : { color: 0x6a90ff, size: 0.045, transparent: true, opacity: 0.8 })); sc.add(pts);
    if (cfg.env === 'dust') {
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x050a20, roughness: 0.15, metalness: 0.8 })); fl.rotation.x = -Math.PI / 2; fl.position.y = -0.7; sc.add(fl);
      anim.push((_dt, tt) => { pts.position.x = Math.sin(tt * 0.1) * 0.6; pts.rotation.y = tt * 0.02; });
    } else anim.push((_dt, tt) => { pts.rotation.z = tt * 0.01; });
  } else if (cfg.env === 'bubbles') {
    const bs: THREE.Mesh[] = [];
    for (let i = 0; i < 26; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.1 + Math.random() * 0.3, 16, 12), new THREE.MeshStandardMaterial({ color: 0x9b8cff, transparent: true, opacity: 0.25, roughness: 0.1, metalness: 0.3 }));
      b.position.set((Math.random() - 0.5) * 12, -4 + Math.random() * 8, -2 - Math.random() * 6); b.userData.v = 0.2 + Math.random() * 0.4; sc.add(b); bs.push(b);
    }
    anim.push(dt => bs.forEach(b => { b.position.y += (b.userData.v as number) * dt; if (b.position.y > 4) b.position.y = -4; }));
  } else if (cfg.env === 'dsgrid') {
    const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d')!;
    x.fillStyle = '#eef1f6'; x.fillRect(0, 0, 32, 32); x.fillStyle = '#c9d2df'; x.fillRect(0, 0, 32, 2); x.fillRect(0, 0, 2, 32);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(40, 40); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    const f = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshBasicMaterial({ map: t })); f.rotation.x = -Math.PI / 2; f.position.y = -0.85; sc.add(f);
    anim.push((_dt, tt) => { t.offset.x = tt * 0.02; });
  } else if (cfg.env === 'lines') {
    const g = new THREE.Group();
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(60, 0.05), new THREE.MeshBasicMaterial({ color: i % 3 ? 0x1b3fa8 : 0x3d7bff }));
      m.rotation.x = -Math.PI / 2; m.position.set(0, -0.85, -i * 1.2); g.add(m);
    }
    sc.add(g);
    anim.push((_dt, tt) => { g.position.z = (tt * 1.2) % 1.2; });
  }
  return anim;
}

export function createShelf(canvas: HTMLCanvasElement, cfg: ShelfCfg, still: boolean) {
  const gl = new THREE.WebGLRenderer({ canvas, antialias: cfg.smooth, alpha: false });
  gl.setPixelRatio(1); gl.setSize(cfg.low[0], cfg.low[1], false);
  const sc = new THREE.Scene(); sc.background = new THREE.Color(cfg.bg); sc.fog = new THREE.Fog(cfg.bg, 5, 18);
  const cam = new THREE.PerspectiveCamera(42, cfg.aspect, 0.1, 80);
  sc.add(new THREE.HemisphereLight(0xffffff, 0x202040, 1.3));
  const k = new THREE.DirectionalLight(0xffffff, 2.2); k.position.set(2, 4, 5); sc.add(k);
  const anim = envFor(cfg, sc);
  let nodes: THREE.Group[] = [];
  let sel = 0, camY = 0, raf = 0, last = performance.now();
  const tgt = new THREE.Vector3();
  const imgs = new Map<string, HTMLImageElement | null>();
  let games: ShelfGame[] = [];

  const disposeNode = (o: THREE.Object3D) => o.traverse(x => {
    const m = x as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.MeshBasicMaterial | undefined;
    if (mat) { mat.map?.dispose(); mat.dispose(); }
  });
  const rebuild = () => {
    const old = new Map(nodes.map(n => [n.userData.key as string, n]));
    nodes = games.map(g => {
      const prev = old.get(g.key);
      const sig = `${g.ghost}|${imgs.has(g.cover ?? '') && imgs.get(g.cover ?? '') ? g.cover : ''}`;
      if (prev && prev.userData.sig === sig) { old.delete(g.key); return prev; }
      const n = buildItem(cfg, g, g.cover ? imgs.get(g.cover) ?? null : null);
      n.userData.key = g.key; n.userData.sig = sig;
      if (prev) { n.position.copy(prev.position); n.rotation.copy(prev.rotation); n.scale.copy(prev.scale); }
      sc.add(n); return n;
    });
    for (const o of old.values()) { sc.remove(o); disposeNode(o); }
  };
  const load = (url: string) => {
    if (imgs.has(url)) return;
    imgs.set(url, null);
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => { imgs.set(url, im); rebuild(); };
    im.src = url;
  };

  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000), t = now / 1000; last = now;
    const n = nodes.length, kk = Math.min(1, dt * 7);
    nodes.forEach((m, i) => {
      const on = i === sel; let ry = 0;
      if (cfg.layout === 'row') { tgt.set((i - sel) * 1.75, on ? 0.05 : -0.05, on ? 0.8 : 0); ry = on ? Math.sin(t * 1.2) * 0.35 : i < sel ? 0.55 : -0.55; }
      else if (cfg.layout === 'ring') { const stp = (Math.PI * 2) / Math.max(n, 5), a = (i - sel) * stp, r = Math.max(2.4, n * 0.55); tgt.set(Math.sin(a) * r, on ? 0.1 + Math.sin(t * 2) * 0.05 : 0, Math.cos(a) * r - r + (on ? 0.6 : 0)); ry = on ? Math.sin(t * 1.1) * 0.4 : a * 0.6; }
      else if (cfg.layout === 'grid') { const cols = Math.min(4, n), rr = Math.floor(i / cols), cc = i % cols; tgt.set((cc - (cols - 1) / 2) * 1.55, -rr * 1.5, on ? 0.6 : 0); ry = on ? Math.sin(t * 1.3) * 0.35 : 0; }
      else { const d = i - sel; tgt.set(on ? 0 : d * 0.34 + Math.sign(d) * 1.15, on ? 0.05 : -0.05, on ? 1.0 : 0); ry = on ? Math.sin(t * 0.8) * 0.22 : d < 0 ? 1.35 : -1.35; }
      m.position.lerp(tgt, kk); m.rotation.y += (ry - m.rotation.y) * kk;
      if (cfg.item === 'cd' || cfg.item === 'mini') m.rotation.z = on ? m.rotation.z - dt * 2.2 : m.rotation.z * (1 - kk);
      const s = on ? 1.12 : 0.9; m.scale.lerp(tgt.set(s, s, s), kk);
    });
    if (cfg.layout === 'grid') { const cols = Math.max(1, Math.min(4, n)); camY += (-Math.floor(sel / cols) * 1.5 - camY) * kk; cam.position.set(0, camY + 0.3, 4.6); cam.lookAt(0, camY - 0.6, 0); }
    else if (cfg.layout === 'ring') { cam.position.set(0, 0.9, 3.9); cam.lookAt(0, -0.5, -0.6); }
    else { cam.position.set(0, 0.5, 4.1); cam.lookAt(0, -0.15, 0); }
    anim.forEach(f => f(dt, still ? 0 : t));
    gl.render(sc, cam);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    setGames(list: ShelfGame[]) { games = list; list.forEach(g => g.cover && load(g.cover)); rebuild(); },
    setSel(i: number) { sel = i; },
    dispose() { cancelAnimationFrame(raf); sc.traverse(o => disposeNode(o)); gl.dispose(); },
  };
}
