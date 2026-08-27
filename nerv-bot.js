/* El motor de la mascota. Escrito de cero.

   Del motor que vino en el handoff de Claude Design no queda codigo: quedan
   las MEDICIONES, que es lo que costo sacar. Cada eje de hueso de aqui abajo
   se obtuvo girandolo y viendo a donde se iba el hijo, no suponiendo.

   Lo que cambia de fondo respecto al anterior:

   1. La pose de reposo es una postura de PERSONA PARADA, no la de
      encuadernado. Lo que se anima es esta base; si la base es un maniqui, el
      resultado es un maniqui que se mueve.

   2. El paso es un CICLO DE POSES CLAVE interpolado, como se anima a mano. El
      motor anterior sumaba senos a cada hueso, y un seno hace las dos mitades
      de la zancada iguales: eso es justo lo que se lee como robot.

   3. La pose sale del scroll de forma continua, no al cruzar secciones. */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const leerVar = (n, f) => (getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f);

/* Nombre corto -> patron del nombre real en el esqueleto de Unreal. */
const HUESOS = {
  pelvis: /^pelvis$/i, col1: /^spine_01$/i, col2: /^spine_02$/i, col3: /^spine_03$/i,
  cuello1: /^neck_01$/i, cuello2: /^neck_02$/i, cabeza: /^head$/i,
  ojoL: /^eye_l$/i, ojoR: /^eye_r$/i,
  clavL: /^clavicle_l$/i, clavR: /^clavicle_r$/i,
  brazoL: /^upperarm_l$/i, brazoR: /^upperarm_r$/i,
  codoL: /^lowerarm_l$/i, codoR: /^lowerarm_r$/i,
  manoL: /^hand_l$/i, manoR: /^hand_r$/i,
  musloL: /^thigh_l$/i, musloR: /^thigh_r$/i,
  rodillaL: /^calf_l$/i, rodillaR: /^calf_r$/i,
  pieL: /^foot_l$/i, pieR: /^foot_r$/i
};

/* LA POSTURA DE PIE. Desplazamientos sobre la pose que trae el archivo, que
   es de encuadernado: brazos en cruz, palmas al frente, dedos rectos.

   El angulo del hombro NO se estimo. Se barrio midiendo a que distancia del
   eje del cuerpo cae la mano, con el hombro a 0.119:

       z total -1.65 -> 0.006   la mano cruza el eje, va DENTRO del cuerpo
       z total -1.55 -> 0.057   metida en la cadera
       z total -1.35 -> 0.160   <- aqui, con hueco de axila
       z total -1.25 -> 0.212   demasiado abierta

   El bind trae z = -0.683, asi que el desplazamiento es -0.667. */
const PARADA = {
  brazoL: [0.10, 0, -0.667], brazoR: [0.10, 0, -0.655],
  codoL: [0, -0.11, -0.07], codoR: [0, -0.10, -0.07],
  clavL: [0.05, 0, 0], clavR: [0.05, 0, 0],
  rodillaL: [0, -0.07, 0], rodillaR: [0, -0.06, 0],
  pieL: [0, 0.05, 0], pieR: [0, -0.05, 0]
};

/* EL CICLO DE PASO. Cuatro poses clave, como se anima a mano. Se interpolan
   en anillo; NO son senos. Al caminar, la pierna en el aire viaja rapido y la
   que apoya se arrastra: esa asimetria es la mitad de lo que hace que se lea
   como andar y no como un pendulo.

   Ejes medidos:  muslo.x + = pierna atras     rodilla.y - = dobla
                  brazo.x + = brazo atras      codo.y    - = dobla */
const CICLO = [
  { musloL: -0.42, rodillaL: -0.06, pieL: 0.16,   // contacto izquierdo
    musloR: 0.34, rodillaR: -0.22, pieR: -0.24,
    brazoL: 0.26, codoL: -0.22, brazoR: -0.30, codoR: -0.34,
    caderaZ: 0.055, caderaY: -0.10, troncoY: 0.07, subir: 0.004 },
  { musloL: -0.04, rodillaL: -0.16, pieL: 0.02,   // paso: rodilla derecha alta
    musloR: -0.30, rodillaR: -0.86, pieR: 0.18,
    brazoL: 0.05, codoL: -0.14, brazoR: -0.06, codoR: -0.22,
    caderaZ: 0.00, caderaY: 0.02, troncoY: -0.01, subir: 0.020 },
  { musloL: 0.34, rodillaL: -0.22, pieL: -0.24,   // contacto derecho
    musloR: -0.42, rodillaR: -0.06, pieR: 0.16,
    brazoL: -0.30, codoL: -0.34, brazoR: 0.26, codoR: -0.22,
    caderaZ: -0.055, caderaY: 0.10, troncoY: -0.07, subir: 0.004 },
  { musloL: -0.30, rodillaL: -0.86, pieL: 0.18,   // paso: rodilla izquierda alta
    musloR: -0.04, rodillaR: -0.16, pieR: 0.02,
    brazoL: -0.06, codoL: -0.22, brazoR: 0.05, codoR: -0.14,
    caderaZ: 0.00, caderaY: -0.02, troncoY: 0.01, subir: 0.020 }
];
const LLAVES = Object.keys(CICLO[0]);

/* LA RUTA. sx: -1 orilla izquierda, 0 centro, +1 orilla derecha.
   alto: cuanto mide ella en fraccion del alto de la ventana.
   atras: 1 = el lienzo se va detras del contenido, y el texto siempre gana. */
const RUTA = [
  ['inicio',      { sx: 0.66, sy: 0.60, alto: 0.62, giro: 0.16, lean: 0, atras: 0 }],
  ['prueba',      { sx: 0.86, sy: 0.62, alto: 0.46, giro: -0.34, lean: 0, atras: 0 }],
  ['servicios',   { sx: -0.60, sy: 0.58, alto: 0.72, giro: 0.46, lean: 0, atras: 1 }],
  ['comparativa', { sx: 0.78, sy: 0.62, alto: 0.44, giro: -0.30, lean: 0, atras: 0 }],
  ['proceso',     { sx: -0.52, sy: 0.58, alto: 0.70, giro: 0.38, lean: 0, atras: 1 }],
  ['trabajo',     { sx: 0.88, sy: 0.63, alto: 0.42, giro: -0.40, lean: 0, atras: 0 }],
  ['preguntas',   { sx: -0.36, sy: 0.58, alto: 0.66, giro: 0.30, lean: 0, atras: 1 }],
  ['contacto',    { sx: 0.34, sy: 0.56, alto: 0.86, giro: -0.32, lean: 1, atras: 0 }]
];
const POSES = RUTA.reduce((a, [id, p]) => (a[id] = p, a), {});

/* GESTOS. Entran en el OBJETIVO del lerp, no se suman al resultado, con una
   envolvente que entra y sale sola: se enciman con el paso y no hay que
   escribir ni una transicion. */
const GESTOS = {
  saludar: { dur: 2.6, f: (p, e) => ({
    brazoR: [-0.30 * e, 0, 1.10 * e],
    codoR: [0, -0.70 * e + Math.sin(p * 21) * 0.32 * e, 0],
    cabeza: [0, -0.10 * e, 0.06 * e] }) },
  pelo: { dur: 3.4, f: (p, e) => ({
    brazoL: [-0.50 * e, 0, 1.25 * e], codoL: [0, -1.30 * e, 0],
    cabeza: [0.05 * e, 0.15 * e, -0.12 * e] }) },
  cruzar: { dur: 5.0, f: (p, e) => ({
    brazoL: [-0.60 * e, 0, 0.38 * e], codoL: [0, -1.40 * e, 0],
    brazoR: [-0.53 * e, 0, 0.32 * e], codoR: [0, -1.28 * e, 0],
    col3: [0.05 * e, 0, 0] }) },
  estirar: { dur: 3.8, f: (p, e) => ({
    brazoL: [0.28 * e, 0, 1.50 * e], brazoR: [0.28 * e, 0, 1.45 * e],
    col3: [-0.12 * e, 0, 0], cabeza: [-0.15 * e, 0, 0] }) },
  pensar: { dur: 4.2, f: (p, e) => ({
    brazoR: [-0.68 * e, 0, 0.70 * e], codoR: [0, -1.50 * e, 0],
    cabeza: [0.09 * e, -0.12 * e, 0.10 * e] }) },
  asomarse: { dur: 3.0, f: (p, e) => ({
    col2: [0, 0.16 * e, 0], col3: [0, 0.20 * e, 0],
    cabeza: [0, 0.30 * e, 0.05 * e] }) },
  peso: { dur: 3.2, f: (p, e) => ({
    pelvis: [0, 0, 0.10 * e], rodillaL: [0, -0.20 * e, 0],
    col2: [0, 0, -0.06 * e] }) },
  asentir: { dur: 1.8, f: (p, e) => ({
    cabeza: [Math.sin(p * 13) * 0.17 * e, 0, 0] }) }
};
const OCIO = ['peso', 'pelo', 'asomarse', 'cruzar', 'pensar', 'estirar', 'peso', 'asomarse'];


class NervBot {
  constructor(lienzo) {
    this.lienzo = lienzo;
    this.t = 0;
    this.puntero = { x: 0, y: 0 };
    this.hueso = {};
    this.reposo = new Map();
    this.pelo = [];
    this.dedos = [];

    this.pose = Object.assign({}, RUTA[0][1]);
    this.scroll = { y: 0, v: 0 };
    this.paso = { fase: 0, vx: 0, ultimaX: null, andando: 0, rumbo: 0 };
    this.mirada = { x: 0, y: 0, tx: 0, ty: 0, falta: 2.5, fuera: false };
    this.parpadeo = { falta: 1.4 + Math.random() * 2.6, fase: -1, doble: false };
    this.sacada = { falta: 0.7, x: 0, y: 0 };
    this.respira = 0;
    this.acto = { nombre: null, t: 0, falta: 4 + Math.random() * 5, ultimo: -1 };
    this.tramos = null;
    this.altoDoc = -1;
    this.velCabeza = 0;
    this.ultCabezaY = 0;

    this.render = new THREE.WebGLRenderer({ canvas: lienzo, alpha: true, antialias: true });
    this.render.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.render.outputColorSpace = THREE.SRGBColorSpace;
    this.render.toneMapping = THREE.ACESFilmicToneMapping;
    this.render.toneMappingExposure = 1.12;

    this.escena = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.render);
    this.escena.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.camara = new THREE.PerspectiveCamera(30, 1, 0.05, 1000);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x5d6577, 1.1);
    const key = new THREE.DirectionalLight(0xfff6ec, 2.1); key.position.set(2.4, 3.2, 4.0);
    const relleno = new THREE.DirectionalLight(0xdfe6f5, 0.75); relleno.position.set(-3.2, 1.1, 2.0);
    this.contorno = new THREE.DirectionalLight(new THREE.Color(leerVar('--accent', '#1c3bf0')), 2.2);
    this.contorno.position.set(-1.6, 2.0, -3.2);
    this.escena.add(this.hemi, key, relleno, this.contorno);

    this.raiz = new THREE.Group();
    this.escena.add(this.raiz);

    this.medir();
    window.addEventListener('resize', () => this.medir());
    window.addEventListener('mousemove', (e) => {
      this.puntero.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.puntero.y = (e.clientY / window.innerHeight) * 2 - 1;
      this.mirada.fuera = false;
      this.mirada.falta = Math.max(this.mirada.falta, 1.6);
    });

    this.ciclo = this.ciclo.bind(this);
    this.raf = requestAnimationFrame(this.ciclo);
    this.cargar();
  }

  cargar() {
    new GLTFLoader().load('./sophia.glb', (gltf) => {
      this.modelo = gltf.scene;
      this.prepararMateriales(this.modelo);
      this.recogerHuesos(this.modelo);
      this.pivote = new THREE.Group();
      this.pivote.add(this.modelo);
      this.raiz.add(this.pivote);
      this.porEncuadrar = true;
      window.dispatchEvent(new CustomEvent('nervbot:model'));
    }, undefined, () => { this.lienzo.style.display = 'none'; });
  }

  /* Los escalares metalness/roughness NO se tocan: el mapa ORM ya trae la
     metalicidad por pixel (0.5% en la cara, 2% en el cuerpo, 58% en el reloj,
     medido). El factor del JSON es un MULTIPLICADOR de ese mapa; bajarlo no
     neutraliza nada, aplana. */
  prepararMateriales(obj) {
    obj.traverse((c) => {
      if (!c.isMesh && !c.isSkinnedMesh) return;
      c.frustumCulled = false;
      (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => {
        if (!m) return;
        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
        m.envMapIntensity = 0.9;
        m.needsUpdate = true;
      });
    });
  }

  recogerHuesos(obj) {
    obj.traverse((b) => {
      if (!b.isBone) return;
      for (const clave in HUESOS) {
        if (!this.hueso[clave] && HUESOS[clave].test(b.name)) this.hueso[clave] = b;
      }
      const p = /^hair(\d+)_(\d+)$/i.exec(b.name);
      if (p) this.pelo.push({ h: b, prof: parseInt(p[2], 10), cadena: parseInt(p[1], 10) });
      const d = /^(thumb|index|middle|ring|pinky)_(\d\d)_(l|r)$/i.exec(b.name);
      if (d) this.dedos.push({ h: b, dedo: d[1].toLowerCase(), falange: parseInt(d[2], 10) });
    });
    const todos = Object.values(this.hueso)
      .concat(this.pelo.map(p => p.h)).concat(this.dedos.map(d => d.h));
    todos.forEach(b => b && this.reposo.set(b, b.rotation.clone()));
    this.plantarse();
  }

  /* La postura de pie se hornea en el reposo: de ahi parte todo lo demas. */
  plantarse() {
    for (const clave in PARADA) {
      const b = this.hueso[clave]; if (!b) continue;
      const r = this.reposo.get(b).clone();
      r.x += PARADA[clave][0]; r.y += PARADA[clave][1]; r.z += PARADA[clave][2];
      this.reposo.set(b, r); b.rotation.copy(r);
    }
    /* La mano relajada: cada falange cierra mas que la anterior y cada dedo
       distinto del vecino -- una mano con los cinco dedos iguales se ve peor
       que una tiesa. Ejes: los dedos cierran con y+, el pulgar con z-. */
    const porDedo = { thumb: 0.9, index: 0.78, middle: 1.0, ring: 1.08, pinky: 1.2 };
    const porFalange = { 1: 0.20, 2: 0.42, 3: 0.34 };
    this.dedos.forEach((d) => {
      const r = this.reposo.get(d.h); if (!r) return;
      const n = r.clone();
      const c = (porFalange[d.falange] || 0.2) * (porDedo[d.dedo] || 1);
      if (d.dedo === 'thumb') n.z -= c * 0.85; else n.y += c;
      this.reposo.set(d.h, n); d.h.rotation.copy(n);
    });
  }

  /* Cuanto mide y donde cae su centro.

     NO se usa Box3.setFromObject: en una malla con skin cuenta la escala de la
     raiz DOS veces y devolvia 181.95 donde la figura mide 1.83. Los factores
     salen de medir la silueta renderizada con la camara a distancia conocida:
     1.8328 de alto con unit = 0.1219, y el centro 0.713 bajo el hueso de la
     cabeza. Para otro personaje: mismo procedimiento, y se ajustan aqui. */
  encuadrar() {
    const B = this.hueso;
    if (!B.cabeza || !B.cuello1) { this.porEncuadrar = false; return; }
    this.raiz.updateWorldMatrix(true, true);
    const hp = B.cabeza.getWorldPosition(new THREE.Vector3());
    const np = B.cuello1.getWorldPosition(new THREE.Vector3());
    const unit = hp.distanceTo(np);
    if (!(unit > 0)) { this.porEncuadrar = false; return; }
    this.k = unit / 0.085;
    this.pivote.position.sub(hp);
    this.altoReal = unit * 15.03;
    this.centroY = unit * -5.85;
    this.camara.near = 0.02 * this.k;
    this.camara.far = 60 * this.k;
    this.camara.position.set(0, 0, this.distanciaPara(this.pose.alto));
    this.camara.lookAt(0, 0, 0);
    this.camara.updateProjectionMatrix();
    this.porEncuadrar = false;
  }

  distanciaPara(frac) {
    const vh = this.altoReal / clamp(frac, 0.05, 3);
    return vh / (2 * Math.tan((this.camara.fov * Math.PI / 180) / 2));
  }

  medir() {
    const w = this.lienzo.clientWidth || window.innerWidth;
    const h = this.lienzo.clientHeight || window.innerHeight;
    this.render.setSize(w, h, false);
    this.camara.aspect = w / h;
    this.camara.updateProjectionMatrix();
    this._w = w; this._h = h;
    this.tramos = null;
  }

  setAccent(hex) { this.contorno.color.set(hex); }
  setTheme(oscuro) {
    this.oscuro = oscuro;
    this.contorno.intensity = oscuro ? 3.2 : 2.1;
    this.hemi.intensity = oscuro ? 0.8 : 1.1;
  }
  setProgress() { /* la ruta se muestrea del scroll directo */ }
  setSection(id) { if (POSES[id] && id !== this.seccion) { this.seccion = id; this.gest('asomarse'); } }
  gest(nombre) { if (GESTOS[nombre]) { this.acto.nombre = nombre; this.acto.t = 0; } }

  medirTramos() {
    const t = [];
    for (let i = 0; i < RUTA.length; i++) {
      const el = document.getElementById(RUTA[i][0]);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      t.push({ centro: r.top + window.scrollY + r.height * 0.5, pose: RUTA[i][1] });
    }
    this.tramos = t.length ? t : null;
    this.altoDoc = document.documentElement.scrollHeight;
  }

  poseDeRuta() {
    if (!this.tramos || this.altoDoc !== document.documentElement.scrollHeight) this.medirTramos();
    const T = this.tramos;
    if (!T || !T.length) return this.pose;
    const mira = (window.scrollY || 0) + window.innerHeight * 0.5;
    if (mira <= T[0].centro) return T[0].pose;
    const fin = T[T.length - 1];
    if (mira >= fin.centro) return fin.pose;
    for (let i = 0; i < T.length - 1; i++) {
      if (mira >= T[i].centro && mira <= T[i + 1].centro) {
        const x = (mira - T[i].centro) / ((T[i + 1].centro - T[i].centro) || 1);
        const e = x * x * (3 - 2 * x);
        const a = T[i].pose, b = T[i + 1].pose, o = {};
        for (const k in a) o[k] = lerp(a[k], b[k], e);
        return o;
      }
    }
    return fin.pose;
  }

  medirPanel() {
    const el = document.querySelector('[data-panel-agente]') || document.querySelector('#contacto input');
    if (!el || !this.camara) return null;
    const r = el.getBoundingClientRect();
    if (!r.width) return null;
    const vh = 2 * this.camara.position.z * Math.tan((this.camara.fov * Math.PI / 180) / 2);
    const vw = vh * this.camara.aspect;
    const px = (r.right + r.width * 0.05) / window.innerWidth;
    const py = (r.top + r.height * 0.15) / window.innerHeight;
    return { x: (px - 0.5) * vw, y: (0.5 - py) * vh - this.centroY };
  }

  /* El ciclo muestreado en la fase f (0..1), interpolando entre las cuatro
     poses clave en anillo, con suavizado en los dos extremos. */
  muestrearCiclo(f) {
    const n = CICLO.length;
    const p = (((f % 1) + 1) % 1) * n;
    const i = Math.floor(p);
    let x = p - i;
    x = x * x * (3 - 2 * x);
    const a = CICLO[i % n], b = CICLO[(i + 1) % n], o = {};
    for (let j = 0; j < LLAVES.length; j++) o[LLAVES[j]] = lerp(a[LLAVES[j]], b[LLAVES[j]], x);
    return o;
  }

  ciclo() {
    this.raf = requestAnimationFrame(this.ciclo);
    const dt = 1 / 60;
    this.t += dt;
    if (this.porEncuadrar) this.encuadrar();
    if (!this.k) { this.render.render(this.escena, this.camara); return; }

    const t = this.t, B = this.hueso;
    const rep = (b) => this.reposo.get(b);

    /* El gesto se calcula ANTES de posar y entra en el OBJETIVO del lerp.

       Antes se sumaba despues, y eso estaba mal de una forma que no se ve
       hasta que se hace la cuenta: en equilibrio, `r = lerp(r,T,k) + o` da
       `r = T + o/k`. Con k = 0.09 cada gesto se amplificaba ONCE VECES --
       un brazo con offset 1.25 terminaba en 13.9 radianes. Los miembros
       salian disparados cada vez que el reloj de ocio disparaba un gesto. */
    let ofsGesto = null;
    {
      const G = this.acto;
      if (G.nombre && GESTOS[G.nombre]) {
        const g = GESTOS[G.nombre];
        const p = clamp(G.t / g.dur, 0, 1);
        ofsGesto = g.f(p, Math.sin(p * Math.PI));
      }
    }
    const gof = (clave) => (ofsGesto && ofsGesto[clave]) || null;

    const poner = (clave, x, y, z, k) => {
      const b = B[clave]; if (!b) return;
      const r = rep(b); if (!r) return;
      const o = gof(clave);
      const ox = o ? o[0] : 0, oy = o ? o[1] : 0, oz = o ? o[2] : 0;
      b.rotation.x = lerp(b.rotation.x, r.x + x + ox, k);
      b.rotation.y = lerp(b.rotation.y, r.y + y + oy, k);
      b.rotation.z = lerp(b.rotation.z, r.z + z + oz, k);
    };

    const meta = this.poseDeRuta();
    for (const k in meta) this.pose[k] = lerp(this.pose[k], meta[k], 0.07);

    const yAhora = window.scrollY || 0;
    this.scroll.v = lerp(this.scroll.v, (yAhora - this.scroll.y) / Math.max(dt, 0.001), 0.1);
    this.scroll.y = yAhora;
    const vel = clamp(this.scroll.v / 2400, -1, 1);

    // respiracion con periodo que deriva: un seno fijo suena a metronomo
    this.respira += dt * (1.0 + Math.sin(t * 0.081) * 0.22 + Math.sin(t * 0.037 + 2) * 0.1);
    const aire = Math.sin(this.respira);

    const k = this.k;
    const vh = 2 * this.camara.position.z * Math.tan((this.camara.fov * Math.PI / 180) / 2);
    const vw = vh * this.camara.aspect;
    const derivaX = Math.sin(t * 0.23) * 0.011 + Math.sin(t * 0.11 + 2) * 0.007;
    const derivaY = Math.sin(t * 0.31 + 1.2) * 0.006;

    const P = this.paso;
    if (P.ultimaX === null) P.ultimaX = this.raiz.position.x;
    const dx = this.raiz.position.x - P.ultimaX;
    P.ultimaX = this.raiz.position.x;
    P.vx = lerp(P.vx, dx / Math.max(dt, 0.001), 0.12);
    P.andando = lerp(P.andando, clamp(Math.abs(P.vx) / 0.55, 0, 1), 0.06);
    P.fase -= (P.vx / 0.72) * dt;              // una zancada mide ~0.72 m
    P.rumbo = lerp(P.rumbo, clamp(P.vx * 1.6, -1, 1) * 0.5 * P.andando, 0.05);
    const A = P.andando;
    const C = this.muestrearCiclo(P.fase);

    this.raiz.position.x = (this.pose.sx + derivaX) * vw * 0.5;
    this.raiz.position.y = (0.5 - this.pose.sy) * vh - this.centroY
      + derivaY * vh * 0.5 + aire * 0.008 * k + C.subir * A * k - vel * 0.10;
    this.raiz.rotation.x = lerp(this.raiz.rotation.x, vel * 0.045, 0.06);
    this.raiz.rotation.y = lerp(this.raiz.rotation.y,
      this.pose.giro + this.puntero.x * 0.16 + P.rumbo + Math.sin(t * 0.33) * 0.02, 0.05);
    this.raiz.rotation.z = lerp(this.raiz.rotation.z, -this.pose.lean * 0.06 - vel * 0.028, 0.05);

    if (this.pose.lean > 0.02) {
      const dock = this.medirPanel();
      if (dock) {
        const g = this.pose.lean * 0.10;
        this.raiz.position.x = lerp(this.raiz.position.x, dock.x, g);
        this.raiz.position.y = lerp(this.raiz.position.y, dock.y, g);
      }
    }
    const d = lerp(this.camara.position.z, this.distanciaPara(this.pose.alto), 0.045);
    this.camara.position.set(0, 0, d);
    this.camara.lookAt(0, 0, 0);

    /* Profundidad: donde cruza texto se va detras del contenido. El salto se
       hace al pasar por el centro de la pantalla, que es donde no se nota. */
    if (this.host) {
      const z = this.pose.atras > 0.5 ? '5' : '55';
      if (this.host.style.zIndex !== z && (!this.host.style.zIndex || Math.abs(this.pose.sx) < 0.2)) {
        this.host.style.zIndex = z;
      }
    }

    // piernas, cadera y brazos: del ciclo, mezclado con la postura de pie
    const balanceo = Math.sin(t * 0.19) * 0.03 + Math.sin(t * 0.07 + 1.1) * 0.02;
    poner('musloL', C.musloL * A, 0, 0, 0.2);
    poner('musloR', C.musloR * A, 0, 0, 0.2);
    poner('rodillaL', 0, C.rodillaL * A - (1 - A) * 0.02, 0, 0.2);
    poner('rodillaR', 0, C.rodillaR * A + (1 - A) * balanceo * 0.4, 0, 0.2);
    poner('pieL', C.pieL * A, 0, 0, 0.18);
    poner('pieR', C.pieR * A, 0, 0, 0.18);
    poner('pelvis', 0, C.caderaY * A, C.caderaZ * A + (1 - A) * balanceo, 0.12);
    poner('col1', aire * 0.010, C.troncoY * A, 0, 0.10);
    poner('col2', aire * 0.012, C.troncoY * A * 0.5, (1 - A) * balanceo * -0.3, 0.09);
    poner('col3', aire * 0.016, 0, 0, 0.09);
    poner('brazoL', C.brazoL * A, 0, 0, 0.14);
    poner('brazoR', C.brazoR * A, 0, 0, 0.14);
    poner('codoL', 0, C.codoL * A, 0, 0.14);
    poner('codoR', 0, C.codoR * A, 0, 0.14);
    poner('clavL', 0, 0, this.pose.lean * 0.10, 0.06);

    // mirada: sigue al cursor y de vez en cuando voltea a otro lado
    const M = this.mirada;
    M.falta -= dt;
    if (M.falta <= 0) {
      M.fuera = !M.fuera;
      M.falta = M.fuera ? 1.1 + Math.random() * 1.4 : 2.4 + Math.random() * 3.2;
      if (M.fuera) { M.tx = (Math.random() - 0.5) * 1.5; M.ty = (Math.random() - 0.5) * 0.7; }
    }
    M.x = lerp(M.x, M.fuera ? M.tx : this.puntero.x, 0.06);
    M.y = lerp(M.y, M.fuera ? M.ty : this.puntero.y, 0.06);

    poner('cabeza', M.y * 0.20 + aire * 0.012, M.x * 0.30,
          Math.sin(t * 0.7) * 0.025 + this.pose.lean * 0.10, 0.09);
    poner('cuello1', M.y * 0.12, M.x * 0.16, 0, 0.07);
    poner('cuello2', M.y * 0.10, M.x * 0.13, 0, 0.07);
    if (B.cabeza) {
      const hy = B.cabeza.rotation.y;
      this.velCabeza = lerp(this.velCabeza, (hy - this.ultCabezaY) * 60, 0.2);
      this.ultCabezaY = hy;
    }

    /* Parpadeo con agenda aleatoria y a veces doble. Uno cada 4.3 s exactos es
       el tic mas delator que puede tener una cara. */
    const Pp = this.parpadeo;
    Pp.falta -= dt;
    if (Pp.fase < 0 && Pp.falta <= 0) { Pp.fase = 0; Pp.doble = Math.random() < 0.22; }
    let cierre = 0;
    if (Pp.fase >= 0) {
      Pp.fase += dt;
      const ff = Pp.fase;
      const pulso = (a, du) => (ff > a && ff < a + du) ? 1 - Math.abs((ff - a) / du - 0.5) * 2 : 0;
      cierre = Pp.doble ? Math.max(pulso(0, 0.12), pulso(0.19, 0.12)) : pulso(0, 0.14);
      if (ff > (Pp.doble ? 0.34 : 0.16)) { Pp.fase = -1; Pp.falta = 1.6 + Math.random() * 4.4; }
    }
    // sacadas: el ojo no se desliza, salta
    const S = this.sacada;
    S.falta -= dt;
    if (S.falta <= 0) {
      S.x = (Math.random() - 0.5) * 0.10; S.y = (Math.random() - 0.5) * 0.05;
      S.falta = 0.35 + Math.random() * 1.5;
    }
    ['ojoL', 'ojoR'].forEach((clave) => {
      const b = B[clave]; if (!b) return;
      const r = rep(b);
      b.rotation.y = lerp(b.rotation.y, r.y + M.x * 0.22 + S.x, 0.34);
      b.rotation.x = lerp(b.rotation.x, r.x + M.y * 0.14 + S.y, 0.34);
      b.scale.set(1, 1 - cierre * 0.82, 1);
    });

    // el pelo arrastra el giro de la cabeza y la velocidad del scroll
    for (let i = 0; i < this.pelo.length; i++) {
      const h = this.pelo[i], r = rep(h.h);
      if (!r) continue;
      const retardo = h.prof * 0.35;
      const amp = 0.028 + h.prof * 0.012;
      const arrastre = -this.velCabeza * (0.06 + h.prof * 0.03) + vel * (0.055 + h.prof * 0.03);
      h.h.rotation.z = lerp(h.h.rotation.z, r.z + Math.sin(t * 1.15 - retardo + h.cadena * 0.4) * amp + arrastre, 0.09);
      h.h.rotation.x = lerp(h.h.rotation.x, r.x + Math.sin(t * 0.9 - retardo + h.cadena) * amp * 0.6, 0.08);
    }

    /* Los dedos respiran. Una mano perfectamente quieta se ve muerta aunque
       este bien puesta; bastan centesimas de radian. */
    for (let i = 0; i < this.dedos.length; i++) {
      const dd = this.dedos[i], r = rep(dd.h);
      if (!r) continue;
      const ph = i * 0.7;
      const micro = Math.sin(t * 0.9 + ph) * 0.012 + Math.sin(t * 0.31 + ph * 0.5) * 0.018;
      if (dd.dedo === 'thumb') dd.h.rotation.z = lerp(dd.h.rotation.z, r.z - micro, 0.08);
      else dd.h.rotation.y = lerp(dd.h.rotation.y, r.y + micro, 0.08);
    }

    // el reloj de gestos: parada le salen solos, nunca el mismo dos veces
    const G = this.acto;
    if (G.nombre) {
      G.t += dt;
      if (G.t >= GESTOS[G.nombre].dur) { G.nombre = null; G.falta = 3.5 + Math.random() * 6; }
    } else if (A < 0.25) {
      G.falta -= dt;
      if (G.falta <= 0) {
        let i = Math.floor(Math.random() * OCIO.length);
        if (i === G.ultimo) i = (i + 1) % OCIO.length;
        G.ultimo = i;
        this.gest(OCIO[i]);
      }
    }
    /* Los huesos que SOLO toca un gesto (los que no pasan por poner()) se
       resuelven aqui, con el mismo lerp hacia reposo + offset. */
    if (ofsGesto) {
      for (const clave in ofsGesto) {
        if (clave === 'brazoL' || clave === 'brazoR' || clave === 'codoL' ||
            clave === 'codoR' || clave === 'cabeza' || clave === 'pelvis' ||
            clave === 'rodillaL' || clave === 'col2' || clave === 'col3') continue;
        poner(clave, 0, 0, 0, 0.12);
      }
    }

    // el lienzo lo mantiene el motor: si la plantilla se repinta, se re-inserta
    if (!this.lienzo.isConnected) {
      const host = document.getElementById('nerv-bot-host');
      if (host) { this.host = host; host.appendChild(this.lienzo); this.medir(); }
    }
    if (this.lienzo.clientWidth &&
        (this.lienzo.clientWidth !== this._w || this.lienzo.clientHeight !== this._h)) this.medir();
    this.render.render(this.escena, this.camara);
  }
}

function arrancar() {
  const host = document.getElementById('nerv-bot-host');
  if (!host) return setTimeout(arrancar, 120);
  if (window.__nervBot) return;
  const lienzo = document.createElement('canvas');
  lienzo.id = 'nerv-bot';
  lienzo.style.cssText = 'width:100%;height:100%;display:block';
  host.appendChild(lienzo);
  try {
    window.__nervBot = new NervBot(lienzo);
    window.__nervBot.host = host;
    window.dispatchEvent(new CustomEvent('nervbot:ready'));
  } catch (e) {
    lienzo.style.display = 'none';
  }
}
arrancar();
