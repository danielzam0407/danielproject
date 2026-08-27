import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const readVar = (n, f) => (getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f);

/* pose por sección: la mascota recorre la página y cambia de actitud */
const POSES = {
  //            sx: posición horizontal · dist: lejanía · crop: base del cuello en pantalla
  inicio:      { sx: 0.68, crop: 0.45, dist: 1.85, rotY:  0.12, rotZ:  0.00, lean: 0 },
  prueba:      { sx: 0.74, crop: 0.42, dist: 2.05, rotY: -0.22, rotZ:  0.03, lean: 0 },
  servicios:   { sx: 0.66, crop: 0.47, dist: 1.75, rotY:  0.30, rotZ: -0.05, lean: 0 },
  comparativa: { sx: 0.76, crop: 0.43, dist: 2.10, rotY: -0.28, rotZ:  0.05, lean: 0 },
  proceso:     { sx: 0.66, crop: 0.46, dist: 1.80, rotY:  0.26, rotZ: -0.04, lean: 0 },
  trabajo:     { sx: 0.78, crop: 0.41, dist: 2.20, rotY: -0.36, rotZ:  0.05, lean: 0 },
  preguntas:   { sx: 0.67, crop: 0.46, dist: 1.80, rotY:  0.18, rotZ:  0.12, lean: 0 },
  contacto:    { sx: 0.70, crop: 0.49, dist: 1.65, rotY: -0.30, rotZ: -0.13, lean: 1 }
};

class NervBot {
  constructor(canvas) {
    this.canvas = canvas;
    this.t = 0;
    this.pointer = { x: 0, y: 0 };
    this.gaze = { x: 0, y: 0, tx: 0, ty: 0, next: 2.5, away: false };
    this.pose = Object.assign({}, POSES.inicio);
    this.goal = Object.assign({}, POSES.inicio);
    this.transit = 0;
    this.gesture = null;
    this.gestureT = 0;
    this.bones = {};
    this.hair = [];
    this.rest = new Map();
    this.headVel = 0;
    this.lastHeadY = 0;

    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    // corte duro garantizado en el render (el degradado CSS lo suaviza encima)
    this.clip = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.renderer.clippingPlanes = [this.clip];
    this.renderer.localClippingEnabled = true;

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 1000);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x5d6577, 1.15);
    this.scene.add(this.hemi);
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(2.4, 3.2, 4.0);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe6f5, 0.8);
    fill.position.set(-3.2, 1.1, 2.0);
    this.scene.add(fill);
    this.rim = new THREE.DirectionalLight(new THREE.Color(readVar('--accent', '#1c3bf0')), 2.2);
    this.rim.position.set(-1.6, 2.0, -3.2);
    this.scene.add(this.rim);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('mousemove', (e) => {
      this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
      this.gaze.away = false;
      this.gaze.next = Math.max(this.gaze.next, 1.6);
    });

    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
    this.load();
  }

  load() {
    new GLTFLoader().load('./sophia.glb', (gltf) => {
      const obj = gltf.scene;
      this.model = obj;
      this.clips = gltf.animations || [];
      this.prepMaterials(obj);
      this.collectBones(obj);
      this.frameBust(obj);
      if (this.clips.length) {
        this.mixer = new THREE.AnimationMixer(obj);
        this.idleAction = this.mixer.clipAction(this.clips[0]);
        this.idleAction.play();
      }
      window.dispatchEvent(new CustomEvent('nervbot:model'));
    }, undefined, () => { this.canvas.style.display = 'none'; });
  }

  /* el GLB llega con metalness 1 y roughness 1 en todo:
     con eso la piel se ve de plomo y el pelo azul se apaga */
  prepMaterials(obj) {
    obj.traverse((c) => {
      if (!c.isMesh && !c.isSkinnedMesh) return;
      c.frustumCulled = false;
      (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => {
        if (!m) return;
        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
        const n = (m.name || '').toLowerCase();
        if (/watch|metal|jewel/.test(n))      { m.metalness = 0.85; m.roughness = 0.3; }
        else if (/eye(?!lash)|cornea/.test(n)) { m.metalness = 0.0;  m.roughness = 0.12; }
        else if (/eyelash|eyeao|brow/.test(n)){ m.metalness = 0.0;  m.roughness = 0.7; }
        else if (/hair/.test(n))              { m.metalness = 0.0;  m.roughness = 0.42; this.tintHair(m); }
        else if (/outer|coat|cloth/.test(n))  { m.metalness = 0.0;  m.roughness = 0.75; }
        else                                  { m.metalness = 0.0;  m.roughness = 0.62; }
        m.envMapIntensity = 0.7;
        m.needsUpdate = true;
      });
    });
  }

  /* el basecolor del pelo es café casi negro y solo aporta el recorte de
     mechones: se repinta conservando su alfa para recuperar el azul */
  tintHair(m) {
    const src = m.map;
    if (!src || !src.image || !src.image.width) { m.color.set(0x3f74ff); return; }
    const img = src.image;
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0);
    let d;
    try { d = cx.getImageData(0, 0, cv.width, cv.height); } catch (e) { m.color.set(0x3f74ff); return; }
    const p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const lum = (p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11) / 255;
      const l = Math.pow(lum, 0.7);
      p[i]     = Math.min(255, 26 + l * 70);
      p[i + 1] = Math.min(255, 74 + l * 110);
      p[i + 2] = Math.min(255, 198 + l * 57);
    }
    cx.putImageData(d, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.flipY = src.flipY;
    tex.wrapS = src.wrapS; tex.wrapT = src.wrapT;
    tex.repeat.copy(src.repeat); tex.offset.copy(src.offset);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    m.map = tex;
    m.color.set(0xffffff);
    m.needsUpdate = true;
  }

  collectBones(obj) {
    const want = [
      ['head', /^head$/i], ['neck1', /^neck_01$/i], ['neck2', /^neck_02$/i],
      ['spine3', /^spine_03$/i], ['spine2', /^spine_02$/i],
      ['eyeL', /^eye_l$/i], ['eyeR', /^eye_r$/i],
      ['clavL', /^clavicle_l$/i], ['clavR', /^clavicle_r$/i],
      ['armR', /^upperarm_r$/i], ['foreR', /^lowerarm_r$/i],
      ['armL', /^upperarm_l$/i], ['foreL', /^lowerarm_l$/i]
    ];
    obj.traverse((b) => {
      if (!b.isBone) return;
      want.forEach(([k, re]) => { if (!this.bones[k] && re.test(b.name)) this.bones[k] = b; });
      const h = /^hair(\d+)_(\d+)$/i.exec(b.name);
      if (h) this.hair.push({ bone: b, depth: parseInt(h[2], 10), chain: parseInt(h[1], 10) });
    });
    const all = Object.values(this.bones).concat(this.hair.map(h => h.bone));
    all.forEach(b => b && this.rest.set(b, b.rotation.clone()));

    // baja los brazos: el archivo viene en pose de referencia
    ['armL', 'armR'].forEach((k) => {
      const b = this.bones[k]; if (!b) return;
      const r = this.rest.get(b).clone();
      r.z -= 0.85;
      this.rest.set(b, r);
      b.rotation.copy(r);
    });
    ['foreL', 'foreR'].forEach((k) => {
      const b = this.bones[k]; if (!b) return;
      const r = this.rest.get(b).clone();
      r.z -= 0.16;
      this.rest.set(b, r);
      b.rotation.copy(r);
    });
  }

  /* encuadre medido sobre el hueso de la cabeza: no depende de las
     unidades ni de las escalas anidadas que trae el archivo */
  frameBust(obj) {
    this.pivot = new THREE.Group();
    this.pivot.add(obj);
    this.root.add(this.pivot);
    this.needsFrame = true;
  }

  measureFrame() {
    const B = this.bones;
    if (!B.head || !B.neck1) { this.needsFrame = false; return; }
    this.root.updateWorldMatrix(true, true);
    const hp = B.head.getWorldPosition(new THREE.Vector3());
    const np = B.neck1.getWorldPosition(new THREE.Vector3());
    const unit = hp.distanceTo(np);
    if (!(unit > 0)) { this.needsFrame = false; return; }

    this.k = unit / 0.085;                 // cabeza-cuello ≈ 8.5 cm en escala real
    this.pivot.position.sub(hp);           // la cabeza queda en el origen
    // el pecho alto se estima desde la misma cadena de la cabeza:
    // otros esqueletos del archivo (abrigo, pelo) traen escalas distintas
    this.chestOffset = -1.9 * unit;

    const k = this.k;
    this.camera.near = 0.02 * k;
    this.camera.far = 60 * k;
    this.camera.position.set(0, 0, this.pose.dist * k);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.needsFrame = false;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._w = w; this._h = h;
  }

  setAccent(hex) {
    this.rim.color.copy(new THREE.Color(hex));
  }

  setTheme(dark) {
    this.dark = dark;
    this.rim.intensity = dark ? 3.4 : 2.0;
    if (this.hemi) this.hemi.intensity = dark ? 0.8 : 1.15;
  }

  gest(name) { this.gesture = name; this.gestureT = 0; }

  setSection(name) {
    const p = POSES[name];
    if (!p || this.section === name) return;
    this.section = name;
    this.goal = Object.assign({}, p);
    this.transit = 1;
    this.gest(p.lean ? 'lean' : 'glance');
  }

  setProgress(p) { this.scrollP = clamp(p, 0, 1); }

  loop() {
    this.raf = requestAnimationFrame(this.loop);
    const dt = 1 / 60;
    this.t += dt;
    if (this.mixer) this.mixer.update(dt);
    if (this.needsFrame) this.measureFrame();
    if (!this.k) { this.renderer.render(this.scene, this.camera); return; }
    const t = this.t;

    // transición suave entre poses de sección
    ['sx','crop','rotY','rotZ','dist','lean'].forEach(key => {
      this.pose[key] = lerp(this.pose[key], this.goal[key], 0.032);
    });
    this.transit = Math.max(0, this.transit - dt * 0.5);

    let g = 0;
    if (this.gesture) {
      this.gestureT += dt;
      g = this.gestureT;
      if (g > 2.0) { this.gesture = null; this.gestureT = 0; g = 0; }
    }

    // respiración y micro-desplazamientos: nunca queda quieta
    const breath = Math.sin(t * 1.05);
    const sway = Math.sin(t * 0.33) * 0.02 + Math.sin(t * 0.17 + 1.3) * 0.013;

    const k = this.k || 1;
    const camZ = this.camera.position.z;
    const vh = 2 * camZ * Math.tan((this.camera.fov * Math.PI / 180) / 2);
    const vw = vh * this.camera.aspect;
    const arc = Math.sin(this.transit * Math.PI) * 0.035;
    const driftX = Math.sin(t * 0.23) * 0.012 + Math.sin(t * 0.11 + 2) * 0.008;
    const driftY = Math.sin(t * 0.31 + 1.2) * 0.006;
    this.root.position.x = (this.pose.sx + driftX) * vw * 0.5;
    // la altura se calcula para que el pecho caiga en el punto de recorte
    const chest = this.chestOffset || 0;
    this.root.position.y = (0.5 - this.pose.crop) * vh - chest
      + (driftY + arc) * vh * 0.5 + (breath * 0.008 + Math.sin(t * 0.21) * 0.006) * k;
    this.root.rotation.y = lerp(this.root.rotation.y, this.pose.rotY + this.pointer.x * 0.16 + sway, 0.05);
    this.root.rotation.z = lerp(this.root.rotation.z, this.pose.rotZ + this.pose.lean * -0.06, 0.05);
    if (this.pivot) this.pivot.position.z = lerp(this.pivot.position.z, (this.gesture === 'point' ? 0.06 : this.pose.lean * 0.04) * k, 0.05);

    // zoom por sección
    const d = lerp(this.camera.position.z, this.pose.dist * k, 0.035);
    this.camera.position.set(0, 0, d);
    this.camera.lookAt(0, 0, 0);

    const rest = (b) => this.rest.get(b);
    const B = this.bones;

    // mirada: sigue el cursor, y de vez en cuando voltea a otro lado
    this.gaze.next -= dt;
    if (this.gaze.next <= 0) {
      this.gaze.away = !this.gaze.away;
      this.gaze.next = this.gaze.away ? 1.1 + Math.random() * 1.4 : 2.4 + Math.random() * 3.2;
      if (this.gaze.away) {
        this.gaze.tx = (Math.random() - 0.5) * 1.5;
        this.gaze.ty = (Math.random() - 0.5) * 0.7;
      }
    }
    const gx = this.gaze.away ? this.gaze.tx : this.pointer.x;
    const gy = this.gaze.away ? this.gaze.ty : this.pointer.y;
    this.gaze.x = lerp(this.gaze.x, gx, 0.06);
    this.gaze.y = lerp(this.gaze.y, gy, 0.06);

    const nod   = this.gesture === 'nod'    ? Math.sin(g * 7.5) * 0.2 * Math.max(0, 1 - g / 1.6) : 0;
    const tilt  = this.gesture === 'point'  ? 0.24 * Math.min(1, g / 0.3) : 0;
    const peek  = this.gesture === 'glance' ? Math.sin(g * 3.4) * 0.12 * Math.max(0, 1 - g / 1.4) : 0;

    if (B.head) {
      const r = rest(B.head);
      B.head.rotation.x = lerp(B.head.rotation.x, r.x + this.gaze.y * 0.2 + breath * 0.012 + nod, 0.1);
      B.head.rotation.y = lerp(B.head.rotation.y, r.y + this.gaze.x * 0.3 + peek, 0.08);
      B.head.rotation.z = lerp(B.head.rotation.z, r.z + Math.sin(t * 0.7) * 0.025 + tilt + this.pose.lean * 0.12, 0.08);
      const hy = B.head.rotation.y;
      this.headVel = lerp(this.headVel, (hy - this.lastHeadY) * 60, 0.2);
      this.lastHeadY = hy;
    }
    [['neck1', 0.12], ['neck2', 0.1]].forEach(([k, f]) => {
      const b = B[k]; if (!b) return;
      const r = rest(b);
      b.rotation.x = lerp(b.rotation.x, r.x + this.gaze.y * f, 0.07);
      b.rotation.y = lerp(b.rotation.y, r.y + this.gaze.x * f * 1.3, 0.07);
    });
    [['spine3', 0.018], ['spine2', 0.012]].forEach(([k, f]) => {
      const b = B[k]; if (!b) return;
      const r = rest(b);
      b.rotation.x = lerp(b.rotation.x, r.x + breath * f, 0.08);
      b.rotation.y = lerp(b.rotation.y, r.y + this.gaze.x * 0.05 + this.pose.lean * 0.06, 0.05);
    });

    // ojos: gaze fino + parpadeo simulado achatando el globo
    const blinkPhase = (t % 4.3);
    const blink = blinkPhase < 0.11 ? 1 - Math.abs(blinkPhase - 0.055) / 0.055 : 0;
    [['eyeL', 1], ['eyeR', 1]].forEach(([k]) => {
      const b = B[k]; if (!b) return;
      const r = rest(b);
      b.rotation.y = lerp(b.rotation.y, r.y + this.gaze.x * 0.22, 0.14);
      b.rotation.x = lerp(b.rotation.x, r.x + this.gaze.y * 0.14, 0.14);
      const s = 1 - blink * 0.82;
      b.scale.set(1, s, 1);
    });

    // el pelo arrastra el movimiento de la cabeza con retardo por eslabón
    for (let i = 0; i < this.hair.length; i++) {
      const h = this.hair[i];
      const r = rest(h.bone);
      if (!r) continue;
      const delay = h.depth * 0.35;
      const amp = 0.028 + h.depth * 0.012;
      const drag = -this.headVel * (0.06 + h.depth * 0.03);
      h.bone.rotation.z = lerp(h.bone.rotation.z, r.z + Math.sin(t * 1.15 - delay + h.chain * 0.4) * amp + drag, 0.09);
      h.bone.rotation.x = lerp(h.bone.rotation.x, r.x + Math.sin(t * 0.9 - delay + h.chain) * amp * 0.6, 0.08);
    }

    // brazo: saludo solo cuando cabe en cuadro
    if (B.armR) {
      const r = rest(B.armR);
      const wave = this.gesture === 'wave' ? 0.9 * Math.min(1, g / 0.3) : 0;
      B.armR.rotation.z = lerp(B.armR.rotation.z, r.z + wave + breath * 0.01, 0.1);
      if (B.foreR) {
        const rf = rest(B.foreR);
        B.foreR.rotation.y = lerp(B.foreR.rotation.y, rf.y + (this.gesture === 'wave' ? Math.sin(g * 11) * 0.4 : 0), 0.18);
      }
    }
    if (B.armL) {
      const r = rest(B.armL);
      const point = this.gesture === 'point' ? 0.5 : 0;
      B.armL.rotation.z = lerp(B.armL.rotation.z, r.z + point + breath * 0.012, 0.09);
    }
    if (B.clavL && this.pose.lean) {
      const r = rest(B.clavL);
      B.clavL.rotation.z = lerp(B.clavL.rotation.z, r.z + this.pose.lean * 0.12, 0.05);
    }
    if (this.gesture === 'spin') this.root.rotation.y += 0.13;

    // el plano de corte sigue la línea del cuello en cada pose, y el
    // degradado del contenedor se calcula del MISMO número: así el corte
    // siempre cae donde la máscara ya es transparente
    if (this.chestOffset != null) {
      const cutY = this.root.position.y + this.chestOffset * 1.2;
      this.clip.constant = -cutY;
      const frac = 0.5 - cutY / vh;
      if (this.host && Math.abs((this._maskFrac ?? -9) - frac) > 0.004) {
        this._maskFrac = frac;
        const a = Math.max(0.04, frac - 0.17).toFixed(3);
        const b = Math.max(0.06, frac - 0.085).toFixed(3);
        const c = Math.max(0.08, frac - 0.005).toFixed(3);
        const g = 'linear-gradient(to bottom,#000 0 ' + (a * 100).toFixed(1) + '%,rgba(0,0,0,.55) ' +
          (b * 100).toFixed(1) + '%,transparent ' + (c * 100).toFixed(1) + '%)';
        this.host.style.webkitMaskImage = g;
        this.host.style.maskImage = g;
      }
    }
    if (!this.canvas.isConnected) {
      const host = document.getElementById('nerv-bot-host');
      if (host) { this.host = host; host.appendChild(this.canvas); this.resize(); }
    }
    if (this.canvas.clientWidth && (this.canvas.clientWidth !== this._w || this.canvas.clientHeight !== this._h)) this.resize();
    this.renderer.render(this.scene, this.camera);
  }
}

/* el lienzo lo crea y lo mantiene el motor: si la plantilla se vuelve a
   renderizar, se re-inserta en su contenedor en lugar de quedar huérfano */
function boot() {
  const host = document.getElementById('nerv-bot-host');
  if (!host) return setTimeout(boot, 120);
  if (window.__nervBot) return;
  const canvas = document.createElement('canvas');
  canvas.id = 'nerv-bot';
  canvas.style.cssText = 'width:100%;height:100%;display:block';
  host.appendChild(canvas);
  try {
    window.__nervBot = new NervBot(canvas);
    window.__nervBot.host = host;
    window.dispatchEvent(new CustomEvent('nervbot:ready'));
  } catch (e) {
    canvas.style.display = 'none';
  }
}
boot();
