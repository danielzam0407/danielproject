import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const readVar = (n, f) => (getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f);

/* LA RUTA.

   Antes esto era un diccionario de poses por seccion y el movimiento se
   disparaba al cruzar una frontera: dentro de una seccion no pasaba nada y
   subiendo tampoco. Ahora es un CAMINO -- se muestrea con la posicion real
   del scroll, asi que baja y sube por el mismo trazo y nunca hay un salto.

   sx     posicion horizontal en fraccion de media pantalla: -1 orilla
          izquierda, 0 centro, +1 orilla derecha. Cruza la pagina de verdad.
   sy     donde cae su centro, de 0 (arriba) a 1 (abajo).
   alto   cuanto mide ella en pantalla, en fraccion del alto de la ventana.
          De aqui sale la distancia de camara, asi que el encuadre es el
          mismo en cualquier viewport y no hay numeros magicos.
   atras  1 = el lienzo se va DETRAS del contenido. Es lo unico que le permite
          recorrer la pagina entera sin taparle el texto a nadie: donde hay
          parrafo pasa por detras, donde hay aire vuelve al frente.
   lean   se recarga en el recuadro del agente; el sitio exacto se MIDE. */
const RUTA = [
  ['inicio',      { sx:  0.66, sy: 0.60, alto: 0.62, rotY:  0.16, rotZ:  0.00, lean: 0, atras: 0 }],
  ['prueba',      { sx:  0.86, sy: 0.62, alto: 0.46, rotY: -0.34, rotZ:  0.05, lean: 0, atras: 0 }],
  ['servicios',   { sx: -0.60, sy: 0.58, alto: 0.72, rotY:  0.46, rotZ: -0.06, lean: 0, atras: 1 }],
  ['comparativa', { sx:  0.78, sy: 0.62, alto: 0.44, rotY: -0.30, rotZ:  0.06, lean: 0, atras: 0 }],
  ['proceso',     { sx: -0.52, sy: 0.58, alto: 0.70, rotY:  0.38, rotZ: -0.05, lean: 0, atras: 1 }],
  ['trabajo',     { sx:  0.88, sy: 0.63, alto: 0.42, rotY: -0.40, rotZ:  0.06, lean: 0, atras: 0 }],
  ['preguntas',   { sx: -0.36, sy: 0.58, alto: 0.66, rotY:  0.30, rotZ:  0.09, lean: 0, atras: 1 }],
  ['contacto',    { sx:  0.34, sy: 0.56, alto: 0.86, rotY: -0.32, rotZ: -0.09, lean: 1, atras: 0 }]
];

const POSES = RUTA.reduce((a, [id, p]) => (a[id] = p, a), {});

/* EL REPERTORIO.

   Cada gesto devuelve desplazamientos que se SUMAN a la pose que ya quedo
   puesta, no valores absolutos. Por eso se encima con el paso y con la
   respiracion sin pelearse: puede saludar mientras camina, y el brazo hace
   las dos cosas a la vez.

   `e` es una envolvente que entra y sale sola (0 -> 1 -> 0), asi que ningun
   gesto empieza ni termina con un salto y no hay que escribir transiciones.
   `p` es el avance de 0 a 1, para los que llevan coreografia por dentro.

   Ejes, todos medidos sobre este esqueleto y no supuestos:
     upperarm.z +  el brazo se separa del cuerpo    upperarm.x -  brazo adelante
     lowerarm.y -  el codo dobla                    calf.y     -  la rodilla dobla
     dedos.y    +  cierran                          thumb.z    -  cierra */
const GESTOS = {
  saludar: { dur: 2.6, hacer: (p, e) => ({
    armR:  [-0.35 * e, 0, 1.15 * e],
    foreR: [0, -0.75 * e + Math.sin(p * 22) * 0.34 * e, 0],
    manoR: [0, 0, Math.sin(p * 22) * 0.30 * e],
    head:  [0, -0.10 * e, 0.06 * e],
    spine3:[0, -0.07 * e, 0]
  })},

  pelo: { dur: 3.4, hacer: (p, e) => ({
    armL:  [-0.55 * e, 0, 1.30 * e],
    foreL: [0, -1.35 * e, 0],
    manoL: [0.25 * e, 0, 0],
    head:  [0.05 * e, 0.16 * e, -0.13 * e],
    neck1: [0, 0.06 * e, 0]
  })},

  cruzar: { dur: 5.0, hacer: (p, e) => ({
    armL:  [-0.62 * e, 0, 0.40 * e],
    foreL: [0, -1.42 * e, 0],
    armR:  [-0.55 * e, 0, 0.34 * e],
    foreR: [0, -1.30 * e, 0],
    spine3:[0.05 * e, 0, 0],
    head:  [0.03 * e, 0, 0]
  })},

  estirar: { dur: 3.8, hacer: (p, e) => ({
    armL:  [0.30 * e, 0, 1.55 * e],
    armR:  [0.30 * e, 0, 1.50 * e],
    foreL: [0, -0.30 * e, 0],
    foreR: [0, -0.28 * e, 0],
    spine3:[-0.13 * e, 0, 0],
    spine2:[-0.09 * e, 0, 0],
    head:  [-0.16 * e, 0, 0]
  })},

  pensar: { dur: 4.2, hacer: (p, e) => ({
    armR:  [-0.70 * e, 0, 0.72 * e],
    foreR: [0, -1.55 * e, 0],
    armL:  [-0.20 * e, 0, 0.28 * e],
    foreL: [0, -0.85 * e, 0],
    head:  [0.09 * e, -0.13 * e, 0.10 * e],
    neck1: [0.04 * e, 0, 0]
  })},

  // se asoma: gira el tronco entero, no solo el cuello
  asomarse: { dur: 3.0, hacer: (p, e) => ({
    spine2:[0, 0.16 * e, 0],
    spine3:[0, 0.20 * e, 0],
    head:  [0, 0.30 * e, 0.05 * e],
    armL:  [-0.14 * e, 0, 0.10 * e],
    armR:  [0.10 * e, 0, 0]
  })},

  // cambia el peso de un pie al otro: lo mas comun que hace alguien parado
  peso: { dur: 3.2, hacer: (p, e) => ({
    pelvis:[0, 0, 0.10 * e],
    pantL: [0, -0.22 * e, 0],
    pantR: [0, 0.06 * e, 0],
    spine2:[0, 0, -0.06 * e],
    head:  [0, 0, -0.05 * e]
  })},

  asentir: { dur: 1.8, hacer: (p, e) => ({
    head:  [Math.sin(p * 13) * 0.17 * e, 0, 0],
    neck1: [Math.sin(p * 13 - 0.5) * 0.07 * e, 0, 0]
  })},

  senalar: { dur: 2.8, hacer: (p, e) => ({
    armL:  [-1.05 * e, 0, 0.55 * e],
    foreL: [0, -0.35 * e, 0],
    head:  [0, 0.14 * e, 0],
    spine3:[0, 0.08 * e, 0]
  })}
};

// los que le salen solos cuando esta parada
const OCIO = ['peso', 'pelo', 'asomarse', 'cruzar', 'pensar', 'estirar', 'peso', 'asomarse'];

class NervBot {
  constructor(canvas) {
    this.canvas = canvas;
    this.t = 0;
    this.pointer = { x: 0, y: 0 };
    this.gaze = { x: 0, y: 0, tx: 0, ty: 0, next: 2.5, away: false };
    this.pose = Object.assign({}, RUTA[0][1]);
    this.goal = Object.assign({}, RUTA[0][1]);
    this.transit = 0;
    this.gesture = null;
    this.gestureT = 0;
    this.bones = {};
    this.hair = [];
    this.rest = new Map();
    this.headVel = 0;
    this.lastHeadY = 0;
    this.scroll = { y: 0, v: 0 };
    this.parpadeo = { falta: 1.4 + Math.random() * 2.6, fase: -1, doble: false };
    this.sacada = { falta: 0.7, x: 0, y: 0 };
    this.respira = 0;
    this.tramos = null;
    this.altoDoc = -1;
    this.paso = { fase: 0, vx: 0, ultimaX: null, andando: 0, rumbo: 0 };
    this.acto = { nombre: null, t: 0, falta: 4 + Math.random() * 5, ultimo: -1 };

    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    /* Sin plano de recorte. Venia cortandola a la altura del pecho porque el
       handoff daba por hecho que abajo el modelo no aguantaba mirada. Medido,
       si aguanta: la figura esta entera, con torso, brazos y piernas. Y una
       cabeza flotando dentro de un degradado no es un personaje, es un
       adorno -- se ve ella completa. */

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

  /* Los escalares metalness/roughness NO se tocan, a proposito.

     El handoff decia que el GLB llega con metalness 1 en todo y por eso los
     bajaba por nombre de material. Medido, es al reves: el mapa ORM ya trae
     la metalicidad por pixel -- 0.5% en la cara, 2% en el cuerpo, 58% solo en
     el reloj, que es justo lo correcto. El `metallicFactor: 1` que se leia en
     el JSON es un MULTIPLICADOR de ese mapa, no un valor final.

     Y como multiplica, bajarlo aqui no neutralizaba nada: aplanaba. La
     rugosidad del cuerpo pasaba de 0.35 a 0.22 y la del pelo de 0.09 a 0.038,
     o sea espejo. Se quitaron: lo que se pidio fue realismo, y el mapa
     pintado a mano le gana a seis reglas por nombre. */
  prepMaterials(obj) {
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

  /* Aqui vivia tintHair(): repintaba el pelo de azul pixel por pixel en un
     canvas, remapeando la luminancia a (26+l*70, 74+l*110, 198+l*57). Era
     invento del handoff, no del personaje. El pelo va negro, como viene. */

  collectBones(obj) {
    const want = [
      ['head', /^head$/i], ['neck1', /^neck_01$/i], ['neck2', /^neck_02$/i],
      ['spine3', /^spine_03$/i], ['spine2', /^spine_02$/i],
      ['eyeL', /^eye_l$/i], ['eyeR', /^eye_r$/i],
      ['clavL', /^clavicle_l$/i], ['clavR', /^clavicle_r$/i],
      ['armR', /^upperarm_r$/i], ['foreR', /^lowerarm_r$/i],
      ['armL', /^upperarm_l$/i], ['foreL', /^lowerarm_l$/i],
      /* El tren inferior. No estaba: el motor del handoff se escribio para un
         busto cortado al pecho, asi que de las costillas para abajo no habia
         nada que animar. Por eso no caminaba -- nadie le movia las piernas. */
      ['pelvis', /^pelvis$/i], ['spine1', /^spine_01$/i],
      ['musloL', /^thigh_l$/i], ['musloR', /^thigh_r$/i],
      ['pantL',  /^calf_l$/i],  ['pantR',  /^calf_r$/i],
      ['pieL',   /^foot_l$/i],  ['pieR',   /^foot_r$/i],
      ['manoL',  /^hand_l$/i],  ['manoR',  /^hand_r$/i]
    ];
    // los 30 huesos de dedo, que hasta ahora estaban tiesos y abiertos
    this.dedos = [];
    obj.traverse((b) => {
      if (!b.isBone) return;
      want.forEach(([k, re]) => { if (!this.bones[k] && re.test(b.name)) this.bones[k] = b; });
      const h = /^hair(\d+)_(\d+)$/i.exec(b.name);
      if (h) this.hair.push({ bone: b, depth: parseInt(h[2], 10), chain: parseInt(h[1], 10) });
      const f = /^(thumb|index|middle|ring|pinky)_(\d\d)_(l|r)$/i.exec(b.name);
      if (f) this.dedos.push({ bone: b, dedo: f[1].toLowerCase(),
                               falange: parseInt(f[2], 10), lado: f[3].toLowerCase() });
    });
    const all = Object.values(this.bones)
      .concat(this.hair.map(h => h.bone))
      .concat(this.dedos.map(d => d.bone));
    all.forEach(b => b && this.rest.set(b, b.rotation.clone()));

    this.relajarPose();
  }

  /* LA POSTURA DE REPOSO.

     El archivo viene en pose de encuadernado: brazos rectos y abiertos, palmas
     al frente, y los treinta huesos de dedo tiesos y separados. El motor del
     handoff solo bajaba los brazos (z -= 0.85) y con eso se conformaba.

     Eso es lo que la hacia leerse como maniqui por bien que se moviera
     despues: lo que se anima es ESTA base, y si la base es un maniqui, el
     resultado es un maniqui que se mueve. Aqui se le da una postura de
     persona parada, y de ahi parte todo lo demas.

     Los ejes estan medidos sobre el propio esqueleto, girando cada hueso y
     viendo si la punta se acerca o se aleja de su ancla:
       codo    y-  (la mano se acerca 88 mm al hombro)
       rodilla y-  (el pie se acerca 80 mm al muslo)
       dedos   y+  (la punta se acerca 13-15 mm a la muneca)
       pulgar  z-  (7 mm) */
  relajarPose() {
    const mover = (k, dx, dy, dz) => {
      const b = this.bones[k]; if (!b) return;
      const r = this.rest.get(b).clone();
      r.x += dx; r.y += dy; r.z += dz;
      this.rest.set(b, r);
      b.rotation.copy(r);
    };

    /* Los brazos cuelgan con un hueco de axila, no pegados al cuerpo.

       El numero NO se estima: se barrio el angulo midiendo a que distancia del
       eje del cuerpo cae la mano. El hombro esta a 0.119 del eje y una mano
       relajada tiene que caer entre 0.13 y 0.19 -- o sea un poco MAS afuera
       que el hombro, que es lo que abre la axila.

           z = -1.65  ->  0.006   la mano cruza el eje: dentro del cuerpo
           z = -1.55  ->  0.057   metida en la cadera
           z = -1.45  ->  0.108   rozando
           z = -1.35  ->  0.160   <- aqui
           z = -1.25  ->  0.212   demasiado abierta

       Estaba en -1.543: le pasaba de noventa grados al bajarlos desde la pose
       en cruz, y las manos terminaban adentro. */
    mover('armL', 0.10, 0.00, -0.667);
    mover('armR', 0.10, 0.00, -0.655);   // asimetria: ni los brazos son gemelos
    // el codo NUNCA esta recto en alguien de pie
    mover('foreL', 0, -0.11, -0.07);
    mover('foreR', 0, -0.10, -0.07);   // asimetria tambien aqui
    // los hombros caen un poco
    mover('clavL', 0.05, 0, 0);
    mover('clavR', 0.05, 0, 0);
    // rodillas apenas cedidas y pies ligeramente abiertos
    mover('pantL', 0, -0.07, 0);
    mover('pantR', 0, -0.06, 0);      // asimetria: nadie esta parado parejo
    mover('pieL', 0, 0.05, 0);
    mover('pieR', 0, -0.05, 0);

    /* La mano relajada. Cada falange cierra un poco mas que la anterior, y
       cada dedo un poco distinto del vecino -- una mano donde los cinco dedos
       hacen exactamente lo mismo se ve peor que una tiesa. */
    const porDedo = { thumb: 0.9, index: 0.78, middle: 1.0, ring: 1.08, pinky: 1.2 };
    const porFalange = { 1: 0.20, 2: 0.42, 3: 0.34 };
    this.dedos.forEach((d) => {
      const b = d.bone;
      const r = this.rest.get(b); if (!r) return;
      const n = r.clone();
      const cuanto = (porFalange[d.falange] || 0.2) * (porDedo[d.dedo] || 1);
      if (d.dedo === 'thumb') n.z -= cuanto * 0.85;
      else n.y += cuanto;
      this.rest.set(b, n);
      b.rotation.copy(n);
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

    /* Cuanto mide ella y donde cae su centro.

       NO se usa Box3.setFromObject: en una malla con skin cuenta la escala de
       la raiz DOS veces y devolvia 181.95 donde la figura mide 1.83. Es la
       misma trampa por la que este motor ya media la camara del hueso y no de
       la caja.

       Estos dos factores salen de una medicion directa: camara a 6.0, render,
       y contar las filas de pixeles opacos de la silueta -> 1.8328 de alto
       con unit = 0.1219, centro 0.713 debajo del hueso de la cabeza. Para
       rehacerla con otro personaje: mismo procedimiento, y se ajustan aqui. */
    this.altoReal = unit * 15.03;
    this.centroY  = unit * -5.85;

    const k = this.k;
    this.camera.near = 0.02 * k;
    this.camera.far = 60 * k;
    this.camera.position.set(0, 0, this.distanciaPara(this.pose.alto));
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
    this.tramos = null;               // el trazo se vuelve a medir al redimensionar
  }

  setAccent(hex) {
    this.rim.color.copy(new THREE.Color(hex));
  }

  setTheme(dark) {
    this.dark = dark;
    this.rim.intensity = dark ? 3.4 : 2.0;
    if (this.hemi) this.hemi.intensity = dark ? 0.8 : 1.15;
  }

  gest(name) {
    // los del repertorio van por su propio reloj; los viejos por el de antes
    if (GESTOS[name]) { this.acto.nombre = name; this.acto.t = 0; return; }
    this.gesture = name; this.gestureT = 0;
  }

  setSection(name) {
    const p = POSES[name];
    if (!p || this.section === name) return;
    this.section = name;
    this.goal = Object.assign({}, p);
    this.transit = 1;
    this.gest(p.lean ? 'lean' : 'glance');
  }

  setProgress(p) { this.scrollP = clamp(p, 0, 1); }

  /* La distancia de camara que hace que ella ocupe `frac` del alto de la
     ventana. Se despeja del fov, no se tantea. */
  distanciaPara(frac) {
    const vh = this.altoReal / clamp(frac, 0.05, 3);
    return vh / (2 * Math.tan((this.camera.fov * Math.PI / 180) / 2));
  }

  /* Donde cae el centro de cada seccion en la pagina. Se mide una vez y se
     vuelve a medir solo si el documento cambio de alto -- no cada cuadro:
     getBoundingClientRect fuerza reflow y esto corre a 60 Hz. */
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

  /* La pose de ESTE instante, interpolada entre los dos tramos vecinos.
     Continua y reversible: subir deshace exactamente lo que bajar hizo. */
  poseDeRuta() {
    if (!this.tramos || this.altoDoc !== document.documentElement.scrollHeight) this.medirTramos();
    const T = this.tramos;
    if (!T || !T.length) return this.goal;
    const mira = (window.scrollY || 0) + window.innerHeight * 0.5;
    if (mira <= T[0].centro) return T[0].pose;
    const fin = T[T.length - 1];
    if (mira >= fin.centro) return fin.pose;
    for (let i = 0; i < T.length - 1; i++) {
      if (mira >= T[i].centro && mira <= T[i + 1].centro) {
        const tramo = T[i + 1].centro - T[i].centro || 1;
        const x = (mira - T[i].centro) / tramo;
        const e = x * x * (3 - 2 * x);        // smoothstep: llega y sale sin esquina
        const a = T[i].pose, b = T[i + 1].pose, o = {};
        for (const k in a) o[k] = lerp(a[k], b[k], e);
        return o;
      }
    }
    return fin.pose;
  }

  /* El recuadro del agente, medido de verdad. Nada de coordenadas a mano: el
     recargo cae bien en cualquier viewport y aguanta un reflow. */
  medirPanel() {
    const el = document.querySelector('[data-panel-agente]')
            || document.querySelector('#contacto input');
    if (!el || !this.camera) return null;
    const r = el.getBoundingClientRect();
    if (!r.width) return null;
    const camZ = this.camera.position.z;
    const vh = 2 * camZ * Math.tan((this.camera.fov * Math.PI / 180) / 2);
    const vw = vh * this.camera.aspect;
    /* Se planta al canto DERECHO del recuadro. El recuadro esta pegado a la
       izquierda de la columna de contenido y lo que queda libre es el carril
       de la derecha: ponerla del otro lado la mandaba media pantalla afuera.
       Y la altura se ancla al canto de ARRIBA, no al centro, porque un codo
       apoyado va a la altura del canto -- no a media caja. */
    const px = (r.right + r.width * 0.05) / window.innerWidth;
    const py = (r.top + r.height * 0.15) / window.innerHeight;
    return { x: (px - 0.5) * vw, y: (0.5 - py) * vh - this.centroY };
  }

  loop() {
    this.raf = requestAnimationFrame(this.loop);
    const dt = 1 / 60;
    this.t += dt;
    if (this.mixer) this.mixer.update(dt);
    if (this.needsFrame) this.measureFrame();
    if (!this.k) { this.renderer.render(this.scene, this.camera); return; }
    const t = this.t;

    /* La pose sale del SCROLL, no de la seccion.

       Antes setProgress() guardaba el avance de la pagina y nadie lo leia
       nunca -- estaba escrito y muerto. Por eso solo se movia al cruzar una
       frontera de seccion y subiendo no pasaba nada. Ahora se muestrea la
       ruta continua y encima va un lerp de arrastre, que es lo que le da
       peso: llega tarde, como un cuerpo, en vez de pegarse al scroll como
       una barra de progreso. */
    const objetivo = this.poseDeRuta();
    ['sx','sy','alto','rotY','rotZ','lean','atras'].forEach(key => {
      this.pose[key] = lerp(this.pose[key], objetivo[key], 0.07);
    });
    this.transit = Math.max(0, this.transit - dt * 0.5);

    // velocidad del scroll CON SIGNO: de aqui salen el arrastre del pelo y la
    // inercia del cuerpo, y por eso bajar y subir no se sienten igual
    const yAhora = window.scrollY || 0;
    this.scroll.v = lerp(this.scroll.v, (yAhora - this.scroll.y) / Math.max(dt, 0.001), 0.1);
    this.scroll.y = yAhora;
    const vel = clamp(this.scroll.v / 2400, -1, 1);

    let g = 0;
    if (this.gesture) {
      this.gestureT += dt;
      g = this.gestureT;
      if (g > 2.0) { this.gesture = null; this.gestureT = 0; g = 0; }
    }

    /* Respiracion con periodo que deriva. Un seno de periodo fijo se
       reconoce como metronomo aunque nadie sepa decir por que. */
    this.respira += dt * (1.0 + Math.sin(t * 0.081) * 0.22 + Math.sin(t * 0.037 + 2) * 0.1);
    const breath = Math.sin(this.respira);
    const sway = Math.sin(t * 0.33) * 0.02 + Math.sin(t * 0.17 + 1.3) * 0.013;

    const k = this.k || 1;
    const camZ = this.camera.position.z;
    const vh = 2 * camZ * Math.tan((this.camera.fov * Math.PI / 180) / 2);
    const vw = vh * this.camera.aspect;
    const arc = Math.sin(this.transit * Math.PI) * 0.035;
    const driftX = Math.sin(t * 0.23) * 0.012 + Math.sin(t * 0.11 + 2) * 0.008;
    const driftY = Math.sin(t * 0.31 + 1.2) * 0.006;
    // cambio de peso de un pie al otro: periodo largo, casi imperceptible,
    // y es la mitad de lo que separa a alguien de pie de un maniqui
    const peso = Math.sin(t * 0.19) * 0.014 + Math.sin(t * 0.07 + 1.1) * 0.009;
    this.root.position.x = (this.pose.sx + driftX + peso) * vw * 0.5;
    this.root.position.y = (0.5 - this.pose.sy) * vh - this.centroY
      + (driftY + arc) * vh * 0.5 + (breath * 0.008 + Math.sin(t * 0.21) * 0.006) * k;
    // inercia: el cuerpo se queda atras un instante y se inclina al viaje
    this.root.position.y -= vel * 0.10;
    this.root.rotation.x = lerp(this.root.rotation.x, vel * 0.045, 0.06);
    this.root.rotation.y = lerp(this.root.rotation.y,
      this.pose.rotY + this.pointer.x * 0.16 + sway + this.paso.rumbo, 0.05);
    this.root.rotation.z = lerp(this.root.rotation.z, this.pose.rotZ + this.pose.lean * -0.06 - vel * 0.028, 0.05);

    /* El recargo del final. El sitio se MIDE del recuadro real cada cuadro y
       se entra a el con el mismo `lean`, asi que el gesto empieza antes de
       llegar y termina exactamente encima. */
    if (this.pose.lean > 0.02) {
      const dock = this.medirPanel();
      if (dock) {
        const f = this.pose.lean * 0.10;
        this.root.position.x = lerp(this.root.position.x, dock.x, f);
        this.root.position.y = lerp(this.root.position.y, dock.y, f);
      }
    }

    /* Profundidad. Donde cruza texto se va DETRAS del contenido y el texto
       siempre gana; donde hay aire, vuelve al frente. Es lo unico que le
       permite recorrer la pagina entera sin estorbarle a nadie. */
    if (this.host) {
      const z = this.pose.atras > 0.5 ? '5' : '55';
      /* El salto de profundidad se hace cuando ella cruza el centro de la
         pantalla, no en cuanto la ruta lo pide: ahi es donde esta de perfil y
         mas lejos del texto, y el cambio no se ve. Todas las transiciones de
         profundidad de la ruta pasan por el centro, asi que siempre hay cruce. */
      if (this.host.style.zIndex !== z &&
          (!this.host.style.zIndex || Math.abs(this.pose.sx) < 0.2)) {
        this.host.style.zIndex = z;
      }
    }
    if (this.pivot) this.pivot.position.z = lerp(this.pivot.position.z, (this.gesture === 'point' ? 0.06 : this.pose.lean * 0.04) * k, 0.05);

    // el acercamiento sale del tamano que debe tener en pantalla
    const d = lerp(this.camera.position.z, this.distanciaPara(this.pose.alto), 0.045);
    this.camera.position.set(0, 0, d);
    this.camera.lookAt(0, 0, 0);

    const rest = (b) => this.rest.get(b);
    const B = this.bones;

    /* ── EL PASO ───────────────────────────────────────────────────────────
       Los ejes de cada hueso estan medidos sobre el propio esqueleto, girando
       uno por uno y viendo a donde se va el hueso hijo:

         thigh.x  +0.5 -> el pie se va 0.42 hacia ATRAS   => x+ = pierna atras
         calf.y   +0.5 -> el pie se va 0.23 hacia ADELANTE => y- = rodilla dobla
         upperarm.x +0.5 -> la mano se va 0.27 atras       => x+ = brazo atras

       Y los dos lados giran igual (no estan espejeados), asi que la unica
       diferencia entre pierna izquierda y derecha es media vuelta de fase.

       La cadencia sale de cuanto se esta desplazando ELLA en el mundo, que a
       su vez lo manda el scroll. Asi el paso no es un bucle decorativo: si la
       pagina no se mueve, ella no camina. */
    const P = this.paso;
    if (P.ultimaX === null) P.ultimaX = this.root.position.x;
    const dx = this.root.position.x - P.ultimaX;
    P.ultimaX = this.root.position.x;
    P.vx = lerp(P.vx, dx / Math.max(dt, 0.001), 0.12);

    const rapidez = Math.abs(P.vx);
    P.andando = lerp(P.andando, clamp(rapidez / 0.55, 0, 1), 0.06);
    // una zancada mide ~0.72 m: de ahi sale cuantos pasos por metro recorrido
    P.fase += (P.vx / 0.72) * Math.PI * 2 * dt * -1;
    // parada pero viva: sigue meciendose despacio en vez de congelarse
    P.fase += dt * 0.55 * (1 - P.andando);

    const f = P.fase;
    const A = P.andando;

    /* La curva del paso NO es un seno. Al caminar, la pierna que va en el aire
       viaja rapido y la que apoya se arrastra despacio -- un seno hace las dos
       mitades iguales, y eso es exactamente lo que se lee como robot. El
       armonico de segundo orden desbalancea las dos mitades. */
    const columpio = (a) => Math.sin(a) + 0.22 * Math.sin(2 * a);

    /* Desfase entre articulaciones (overlapping action). En un cuerpo nada
       arranca al mismo tiempo: la cadera empieza, el tronco la sigue tarde, el
       hombro mas tarde y la mano al final. Sin este retardo todo el esqueleto
       cambia de direccion en el mismo cuadro, que es la firma del muneco. */
    const RET = { pelvis: 0, tronco: 0.16, hombro: 0.30, brazo: 0.42, mano: 0.62 };

    /* Y ruido lento para que nada se repita igual dos veces. Dos senos de
       periodos que no encajan: el ciclo compuesto tarda minutos en cerrar. */
    const vaiven = Math.sin(t * 0.37) * 0.5 + Math.sin(t * 0.23 + 1.7) * 0.5;
    /* La amplitud va atada a la mezcla, no sumada a una base. Con una base
       fija las piernas seguian columpiando parada: los pies quedaban a 0.70 de
       separacion y uno flotaba 9 cm del suelo. Quieta casi no se abren. */
    const zancada  = 0.05 + A * 0.55;     // cuanto abre la pierna
    const rodilla  = 0.04 + A * 0.62;
    const brazoAmp = 0.04 + A * 0.34;

    /* Ella mira hacia donde camina. Cuando se para, vuelve a la pose de la
       ruta -- si no, quedaria de perfil delante de quien la lee. */
    P.rumbo = lerp(P.rumbo, clamp(P.vx * 1.6, -1, 1) * 0.5 * A, 0.05);

    const pierna = (muslo, pant, pie, desfase, guino) => {
      const b1 = B[muslo], b2 = B[pant], b3 = B[pie];
      const s = columpio(f + desfase);
      if (b1) {
        const r = rest(b1);
        b1.rotation.x = lerp(b1.rotation.x, r.x + s * zancada * guino, 0.18);
      }
      if (b2) {
        const r = rest(b2);
        // la rodilla solo dobla hacia atras, nunca al reves: de ahi el max(0)
        const dobla = Math.max(0, Math.sin(f + desfase + 0.9));
        b2.rotation.y = lerp(b2.rotation.y, r.y - dobla * rodilla, 0.18);
      }
      if (b3) {
        const r = rest(b3);
        // el pie llega tarde a la pierna: el tobillo es lo ultimo que gira
        b3.rotation.x = lerp(b3.rotation.x, r.x - columpio(f + desfase - 0.5) * 0.20 * A, 0.16);
      }
    };
    // los dos lados no son un espejo exacto: nadie camina simetrico
    pierna('musloL', 'pantL', 'pieL', 0, 1.0);
    pierna('musloR', 'pantR', 'pieR', Math.PI, 0.94);

    // la pelvis sube y baja dos veces por zancada, y contragira con el tronco
    if (B.pelvis) {
      const r = rest(B.pelvis);
      B.pelvis.rotation.y = lerp(B.pelvis.rotation.y, r.y + Math.sin(f - RET.pelvis) * 0.12 * A, 0.12);
      // el balanceo de cadera parada tambien deriva con el ruido lento
      B.pelvis.rotation.z = lerp(B.pelvis.rotation.z,
        r.z + Math.sin(f) * 0.05 + vaiven * 0.018 * (1 - A), 0.10);
    }
    if (B.spine1) {
      const r = rest(B.spine1);
      B.spine1.rotation.y = lerp(B.spine1.rotation.y, r.y - Math.sin(f - RET.tronco) * 0.09 * A, 0.10);
      B.spine1.rotation.x = lerp(B.spine1.rotation.x, r.x + breath * 0.010, 0.08);
      B.spine1.rotation.z = lerp(B.spine1.rotation.z, r.z + vaiven * 0.012, 0.06);
    }
    // el rebote del cuerpo al caminar, y el peso al estar parada
    this.root.position.y += Math.abs(Math.sin(f)) * 0.018 * A * k
                          - (1 - A) * Math.sin(f * 0.5) * 0.004 * k;

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

    /* Parpadeo con agenda aleatoria y a veces doble. Uno cada 4.3 s exactos
       -- que es lo que habia -- es el tic mas delator que puede tener una
       cara: el ojo lo cacha aunque nadie sepa nombrarlo. */
    this.parpadeo.falta -= dt;
    if (this.parpadeo.fase < 0 && this.parpadeo.falta <= 0) {
      this.parpadeo.fase = 0;
      this.parpadeo.doble = Math.random() < 0.22;
    }
    let blink = 0;
    if (this.parpadeo.fase >= 0) {
      this.parpadeo.fase += dt;
      const f = this.parpadeo.fase;
      const pulso = (a, d) => (f > a && f < a + d) ? 1 - Math.abs((f - a) / d - 0.5) * 2 : 0;
      blink = this.parpadeo.doble ? Math.max(pulso(0, 0.12), pulso(0.19, 0.12)) : pulso(0, 0.14);
      if (f > (this.parpadeo.doble ? 0.34 : 0.16)) {
        this.parpadeo.fase = -1;
        this.parpadeo.falta = 1.6 + Math.random() * 4.4;
      }
    }

    /* Sacadas: el ojo humano no se desliza, salta. Sin esto la mirada se ve
       dibujada por suave que sea el seguimiento. */
    this.sacada.falta -= dt;
    if (this.sacada.falta <= 0) {
      this.sacada.x = (Math.random() - 0.5) * 0.10;
      this.sacada.y = (Math.random() - 0.5) * 0.05;
      this.sacada.falta = 0.35 + Math.random() * 1.5;
    }
    [['eyeL', 1], ['eyeR', 1]].forEach(([k]) => {
      const b = B[k]; if (!b) return;
      const r = rest(b);
      b.rotation.y = lerp(b.rotation.y, r.y + this.gaze.x * 0.22 + this.sacada.x, 0.34);
      b.rotation.x = lerp(b.rotation.x, r.x + this.gaze.y * 0.14 + this.sacada.y, 0.34);
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
      // arrastra con el giro de la cabeza Y con el scroll: al bajar rapido el
      // pelo se queda atras, que es la otra mitad de la sensacion de peso
      const drag = -this.headVel * (0.06 + h.depth * 0.03) + vel * (0.055 + h.depth * 0.03);
      h.bone.rotation.z = lerp(h.bone.rotation.z, r.z + Math.sin(t * 1.15 - delay + h.chain * 0.4) * amp + drag, 0.09);
      h.bone.rotation.x = lerp(h.bone.rotation.x, r.x + Math.sin(t * 0.9 - delay + h.chain) * amp * 0.6, 0.08);
    }

    // brazo: saludo solo cuando cabe en cuadro
    if (B.armR) {
      const r = rest(B.armR);
      const wave = this.gesture === 'wave' ? 0.9 * Math.min(1, g / 0.3) : 0;
      /* Al recargarse, el brazo que descansa sobre el canto es el que queda
         del lado del recuadro. Ella se planta a la derecha de el, asi que es
         el derecho -- el izquierdo se quedaria colgando en el aire. */
      const apoyo = this.pose.lean * 0.40;
      B.armR.rotation.z = lerp(B.armR.rotation.z, r.z + wave - apoyo + breath * 0.01, 0.1);
      // el brazo contrabalancea a la pierna del MISMO lado: media vuelta atras
      B.armR.rotation.x = lerp(B.armR.rotation.x,
        r.x + this.pose.lean * 0.30
            - columpio(f + Math.PI - RET.brazo) * brazoAmp * (1 - this.pose.lean), 0.14);
      if (B.foreR) {
        const rf = rest(B.foreR);
        const saludo = this.gesture === 'wave' ? Math.sin(g * 11) * 0.4 : 0;
        B.foreR.rotation.y = lerp(B.foreR.rotation.y,
          rf.y + saludo - Math.max(0, Math.sin(f + Math.PI - RET.mano)) * 0.34 * A, 0.18);
        B.foreR.rotation.z = lerp(B.foreR.rotation.z, rf.z + this.pose.lean * 0.52, 0.08);
      }
    }
    if (B.armL) {
      const r = rest(B.armL);
      const point = this.gesture === 'point' ? 0.5 : 0;
      B.armL.rotation.z = lerp(B.armL.rotation.z, r.z + point + breath * 0.012, 0.09);
      B.armL.rotation.x = lerp(B.armL.rotation.x,
        r.x - columpio(f - RET.brazo) * brazoAmp * 0.96, 0.14);
      if (B.foreL) {
        const rf = rest(B.foreL);
        // el codo se dobla mas cuando el brazo va adelante, y llega tarde
        B.foreL.rotation.y = lerp(B.foreL.rotation.y,
          rf.y - Math.max(0, Math.sin(f - RET.mano)) * 0.34 * A, 0.14);
      }
    }
    if (B.clavL && this.pose.lean) {
      const r = rest(B.clavL);
      B.clavL.rotation.z = lerp(B.clavL.rotation.z, r.z + this.pose.lean * 0.12, 0.05);
    }
    /* Los dedos respiran. Una mano perfectamente quieta se ve muerta aunque
       este bien puesta; basta con centesimas de radian para que deje de
       leerse como plastico. Cada dedo lleva su propio desfase. */
    for (let i = 0; i < this.dedos.length; i++) {
      const d = this.dedos[i];
      const r = rest(d.bone); if (!r) continue;
      const ph = i * 0.7;
      const micro = Math.sin(t * 0.9 + ph) * 0.012 + Math.sin(t * 0.31 + ph * 0.5) * 0.018;
      const cierraAlAndar = Math.max(0, Math.sin(f - RET.mano)) * 0.10 * A;
      if (d.dedo === 'thumb') {
        d.bone.rotation.z = lerp(d.bone.rotation.z, r.z - micro - cierraAlAndar * 0.6, 0.08);
      } else {
        d.bone.rotation.y = lerp(d.bone.rotation.y, r.y + micro + cierraAlAndar, 0.08);
      }
    }

    /* EL RELOJ DE GESTOS.

       Parada le van saliendo gestos solos, nunca el mismo dos veces seguidas.
       Caminando no se disparan solos -- pero si uno ya venia corriendo, sigue:
       se puede saludar caminando. */
    const A2 = this.paso.andando;
    if (this.acto.nombre) {
      this.acto.t += dt;
      if (this.acto.t >= GESTOS[this.acto.nombre].dur) {
        this.acto.nombre = null;
        this.acto.falta = 3.5 + Math.random() * 6;
      }
    } else if (A2 < 0.25) {
      this.acto.falta -= dt;
      if (this.acto.falta <= 0) {
        let i = Math.floor(Math.random() * OCIO.length);
        if (i === this.acto.ultimo) i = (i + 1) % OCIO.length;
        this.acto.ultimo = i;
        this.gest(OCIO[i]);
      }
    }

    /* El gesto se SUMA encima de lo que ya quedo puesto. Las lineas de arriba
       dejaron cada hueso en su valor base con un lerp; sumar aqui hace que la
       mezcla se deshaga sola al terminar, sin escribir ni una transicion. */
    if (this.acto.nombre && GESTOS[this.acto.nombre]) {
      const G = GESTOS[this.acto.nombre];
      const p = clamp(this.acto.t / G.dur, 0, 1);
      const e = Math.sin(p * Math.PI);
      const ofs = G.hacer(p, e);
      for (const clave in ofs) {
        const hueso = B[clave];
        if (!hueso) continue;
        const o = ofs[clave];
        hueso.rotation.x += o[0];
        hueso.rotation.y += o[1];
        hueso.rotation.z += o[2];
      }
    }

    if (this.gesture === 'spin') this.root.rotation.y += 0.13;

    /* Aqui vivian el plano de corte y el degradado que la encerraban en un
       recuadro. Los dos se fueron: se ve el cuerpo entero y sin marco. La
       mascara del contenedor tambien se quito del marcado. */

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
