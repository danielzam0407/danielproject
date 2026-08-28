/* Ferropalacios — composición continua sobre animations-v3 */
const { CompositionStage, useComposition, Shot, Easing, animate, clamp } = window;
const { useTweaks, TweaksPanel, TweakSection, TweakToggle, TweakColor } = window;

const DEEP = '#0e1013', INK = '#14161a', PANEL = '#1b1e23', LINE = '#2c3138';
const PAPER = '#efeee9', SOFT = '#d7d5cd', STEEL = '#7e8894';
const SANS = "'Space Grotesk', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";

const MOTION = {
  enter: (from, to, start, end) => animate({ from, to, start, end, ease: Easing.easeOutCubic }),
  glide: (from, to, start, end) => animate({ from, to, start, end, ease: Easing.easeInOutQuart }),
  pop: (from, to, start, end) => animate({ from, to, start, end, ease: Easing.easeOutBack }),
};
function kf(T, pts, ease) {
  const e = ease || Easing.easeInOutQuart;
  if (T <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [t0, v0] = pts[i], [t1, v1] = pts[i + 1];
    if (T <= t1) {
      const p = t1 === t0 ? 1 : clamp((T - t0) / (t1 - t0), 0, 1);
      return v0 + (v1 - v0) * e(p);
    }
  }
  return pts[pts.length - 1][1];
}
const rnd = (i, s) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
const pulse = (T, at, w) => clamp(1 - Math.abs(T - at) / w, 0, 1);

/* ---------- geometría del mundo (1920x1080) ----------
   ventana del navegador: 160,120 → 1760,1000                     */
const W = { x: 160, y: 120, w: 1600, h: 880 };
const G = {
  search: { x: 220, y: 286, w: 700, h: 56 },
  sugg: { x: 220, y: 350, w: 700, h: 62 },
  tiles: { y: 740, h: 236, w: 220, step: 252, x0: 220 },
  panel: { x: 860, y: 178, w: 900, h: 822 },
  cart: { x: 1160, y: 178, w: 600, h: 822 },
};
const tileCx = i => G.tiles.x0 + i * G.tiles.step + G.tiles.w / 2;
const HOT = {
  search: [G.search.x + 300, G.search.y + G.search.h / 2],
  sugg: [G.sugg.x + 280, G.sugg.y + 31],
  plus: [G.panel.x + 48 + 165, G.panel.y + 503],
  add: [G.panel.x + 262 + 295, G.panel.y + 503],
  pay: [G.cart.x + 250, G.cart.y + 688],
  tile: i => [tileCx(i) - 40, G.tiles.y + 96],
};

/* ---------- utilería ---------- */

function Placeholder({ label, style, accent }) {
  return (
    <div style={{
      background: `repeating-linear-gradient(125deg, ${PANEL} 0 14px, #23272d 14px 28px)`,
      border: `1px solid ${LINE}`, display: 'flex', alignItems: 'flex-end', padding: 16, overflow: 'hidden', ...style,
    }}>
      <span style={{
        font: `500 14px/1 ${MONO}`, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap',
        color: STEEL, background: DEEP, padding: '7px 10px', border: `1px solid ${LINE}`,
      }}>{label}</span>
      <span style={{ position: 'absolute', top: 16, right: 16, width: 10, height: 10, background: accent }} />
    </div>
  );
}

function HexMark({ size, accent, spin }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ transform: `rotate(${spin}deg)`, display: 'block' }}>
      <polygon points="50,4 90,27 90,73 50,96 10,73 10,27" fill="none" stroke={accent} strokeWidth="7" />
      <circle cx="50" cy="50" r="21" fill="none" stroke={accent} strokeWidth="7" />
    </svg>
  );
}

function Shape({ kind, size, color, accent }) {
  const s = { width: size, height: size, background: color };
  if (kind === 0) return <div style={{ ...s, borderRadius: '50%' }} />;
  if (kind === 1) return <div style={s} />;
  if (kind === 2) return <svg width={size} height={size} viewBox="0 0 100 100"><polygon points="50,3 91,26 91,74 50,97 9,74 9,26" fill={color} /></svg>;
  if (kind === 3) return <div style={{ ...s, transform: 'rotate(45deg)' }} />;
  if (kind === 4) return <div style={{ width: size, height: size, borderRadius: '50%', border: `${Math.max(4, size * 0.22)}px solid ${color}` }} />;
  return <div style={{ width: size, height: Math.max(5, size * 0.3), background: accent }} />;
}

function Cursor({ x, y, press, opacity }) {
  return (
    <div style={{ position: 'absolute', left: x, top: y, opacity, transform: `scale(${1 - press * 0.2})`, transformOrigin: '3px 3px', zIndex: 60 }}>
      <svg width="42" height="52" viewBox="0 0 42 52">
        <path d="M4 2 L4 40 L14 31 L21 47 L29 43 L22 27 L35 26 Z" fill={PAPER} stroke={DEEP} strokeWidth="3" strokeLinejoin="round" />
      </svg>
      <div style={{ position: 'absolute', left: -16, top: -16, width: 48, height: 48, borderRadius: '50%', border: `2px solid ${PAPER}`, opacity: press * 0.85, transform: `scale(${0.45 + press})` }} />
    </div>
  );
}

/* ---------- el sitio ---------- */

const TILES = ['Herramienta', 'Plomería', 'Eléctrico', 'Tornillería', 'Pintura', 'Jardín'];
const QUERY = 'taladro percutor';
const SUGG = [['Taladro percutor 1/2" 750 W', '$1,349'], ['Taladro percutor 5/8" 1100 W', '$2,090'], ['Broca para concreto 1/2"', '$78']];

function Site({ T, C, accent, cartCount, typed, caret, results }) {
  const chrome = MOTION.glide(0, 1, C.Sitio - 0.1, C.Sitio + 0.9)(T);
  const body = MOTION.enter(0, 1, C.Sitio + 0.6, C.Sitio + 1.6)(T);
  const heroWords = ['Todo', 'para', 'la', 'obra.'];
  const searchLive = T > C.Busqueda + 0.85;
  return (
    <div style={{
      position: 'absolute', left: W.x, top: W.y, width: W.w, height: W.h, background: INK,
      border: `1px solid ${LINE}`, boxShadow: '0 60px 120px rgba(0,0,0,0.55)',
      transform: `scaleY(${0.06 + chrome * 0.94})`, transformOrigin: '50% 50%',
      opacity: chrome > 0.02 ? 1 : 0, overflow: 'hidden',
    }}>
      <div style={{ height: 58, background: '#181b20', borderBottom: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', gap: 10, padding: '0 18px' }}>
        {[0, 1, 2].map(i => <span key={i} style={{ width: 11, height: 11, borderRadius: '50%', background: '#343a42' }} />)}
        <div style={{ marginLeft: 14, flex: 1, height: 30, background: DEEP, border: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 8 }}>
          <span style={{ width: 8, height: 8, background: accent }} />
          <span style={{ font: `400 14px ${MONO}`, color: STEEL, letterSpacing: '0.04em' }}>ferropalacios.mx</span>
        </div>
      </div>

      <div style={{ opacity: body }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 30, height: 92, borderBottom: '1px solid #23272d', padding: '0 60px' }}>
          <HexMark size={30} accent={accent} spin={Math.sin(T * 0.4) * 8} />
          <span style={{ font: `700 21px ${SANS}`, letterSpacing: '0.14em', color: PAPER, whiteSpace: 'nowrap' }}>FERROPALACIOS</span>
          <div style={{ display: 'flex', gap: 28, marginLeft: 20 }}>
            {['Catálogo', 'Marcas', 'Sucursales', 'Contacto'].map(n => (
              <span key={n} style={{ font: `500 17px ${SANS}`, color: SOFT, whiteSpace: 'nowrap' }}>{n}</span>
            ))}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ font: `400 14px ${MONO}`, color: STEEL, letterSpacing: '0.06em' }}>CARRITO</span>
            <span style={{
              minWidth: 34, height: 34, background: accent, color: DEEP, font: `700 17px ${SANS}`,
              display: 'grid', placeItems: 'center',
              transform: `scale(${1 + pulse(T, C.Producto + 3.75, 0.35) * 0.35})`,
            }}>{cartCount}</span>
          </div>
        </div>

        {/* buscador */}
        <div style={{
          position: 'absolute', left: G.search.x - W.x, top: G.search.y - W.y, width: G.search.w, height: G.search.h,
          border: `1px solid ${searchLive ? accent : LINE}`, background: searchLive ? '#191d22' : PANEL,
          display: 'flex', alignItems: 'center', padding: '0 20px', gap: 14,
          boxShadow: searchLive ? `0 0 0 3px color-mix(in oklab, ${accent} 16%, transparent)` : 'none',
        }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${searchLive ? accent : STEEL}` }} />
          <span style={{ font: `500 21px ${SANS}`, color: typed ? PAPER : STEEL, whiteSpace: 'nowrap' }}>
            {typed || 'Buscar herramienta, material, marca…'}
          </span>
          <span style={{ width: 2, height: 26, background: accent, opacity: caret }} />
          <span style={{ marginLeft: 'auto', font: `400 14px ${MONO}`, color: STEEL, letterSpacing: '0.1em', opacity: results ? 1 : 0, whiteSpace: 'nowrap' }}>
            {results} RESULTADOS
          </span>
        </div>

        {/* portada */}
        <div style={{ position: 'absolute', left: 60, top: 252, width: 660 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 18px' }}>
            {heroWords.map((w, i) => {
              const a = MOTION.enter(0, 1, C.Sitio + 1.0 + i * 0.14, C.Sitio + 1.7 + i * 0.14)(T);
              return (
                <span key={w} style={{
                  font: `700 78px/1.04 ${SANS}`, letterSpacing: '-0.03em', color: PAPER, display: 'inline-block',
                  opacity: a, transform: `translateY(${(1 - a) * 38}px)`,
                }}>{w}</span>
              );
            })}
          </div>
          <p style={{
            font: `400 21px/1.5 ${SANS}`, color: SOFT, maxWidth: 480, margin: '22px 0 0', textWrap: 'pretty',
            opacity: MOTION.enter(0, 1, C.Sitio + 1.9, C.Sitio + 2.7)(T),
          }}>Catálogo completo de ferretería y material eléctrico, con entrega el mismo día.</p>
          <div style={{ display: 'flex', gap: 14, marginTop: 26, opacity: MOTION.enter(0, 1, C.Sitio + 2.2, C.Sitio + 3.0)(T) }}>
            <span style={{ background: accent, color: DEEP, font: `700 18px ${SANS}`, padding: '15px 26px', whiteSpace: 'nowrap' }}>Ver catálogo</span>
            <span style={{ border: '1px solid #3a4048', color: PAPER, font: `500 18px ${SANS}`, padding: '15px 26px', whiteSpace: 'nowrap' }}>Cotizar obra</span>
          </div>
        </div>
        <div style={{ position: 'absolute', left: 940, top: 252, width: 600, height: 262, opacity: MOTION.enter(0, 1, C.Sitio + 1.4, C.Sitio + 2.4)(T) }}>
          <Placeholder accent={accent} label="foto de mostrador" style={{ position: 'absolute', inset: 0 }} />
          <div style={{ position: 'absolute', left: 0, bottom: -46, display: 'flex', gap: 26 }}>
            {[['12,400', 'productos'], ['3', 'sucursales'], ['48 años', 'surtiendo obra']].map(([n, l]) => (
              <div key={l} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ font: `700 20px ${SANS}`, color: PAPER }}>{n}</span>
                <span style={{ font: `400 13px ${MONO}`, color: STEEL, letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>{l}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ position: 'absolute', left: 60, top: 588, width: 1480, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ font: `500 15px ${MONO}`, letterSpacing: '0.14em', color: STEEL, whiteSpace: 'nowrap' }}>DEPARTAMENTOS</span>
          <span style={{ font: `400 15px ${MONO}`, color: '#4d545c', whiteSpace: 'nowrap' }}>01 / 06</span>
        </div>
      </div>
    </div>
  );
}

function Tiles({ T, C, accent, hov }) {
  return TILES.map((label, i) => {
    const lift = MOTION.pop(0, 1, C.Catalogo - 0.6 + i * 0.07, C.Catalogo + 0.1 + i * 0.07)(T);
    const h = hov(i);
    return (
      <div key={label} style={{
        position: 'absolute', left: G.tiles.x0 + i * G.tiles.step, top: G.tiles.y, width: G.tiles.w, height: G.tiles.h,
        border: `1px solid ${h > 0.02 ? `color-mix(in oklab, ${accent} ${Math.round(h * 100)}%, ${LINE})` : LINE}`,
        background: h > 0.02 ? `color-mix(in oklab, ${accent} ${(h * 9).toFixed(1)}%, ${PANEL})` : PANEL,
        transform: `translateY(${(1 - lift) * 24 - h * 10}px)`,
        opacity: MOTION.enter(0, 1, C.Sitio + 1.2, C.Sitio + 2.0)(T),
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: 18,
        boxShadow: `0 ${22 * h}px ${40 * h}px rgba(0,0,0,${0.45 * h})`,
      }}>
        <span style={{ font: `500 20px ${SANS}`, color: PAPER, whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ font: `400 14px ${MONO}`, color: h > 0.5 ? accent : STEEL, marginTop: 6, letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>VER TODO →</span>
      </div>
    );
  });
}

function Parts({ T, C, accent, opacity, hov }) {
  const out = [];
  for (let i = 0; i < 24; i++) {
    const tile = Math.floor(i / 4), slot = i % 4;
    const sx = 180 + rnd(i, 1) * 1560, sy = 150 + rnd(i, 2) * 760;
    const tx = tileCx(tile) + (slot % 2 ? 30 : -30) - 13;
    const ty = G.tiles.y + 70 + (slot > 1 ? 30 : -30) - 13;
    const st = C.Sitio - 0.9 + i * 0.045, en = st + 1.6;
    const p = MOTION.glide(0, 1, st, en)(T);
    const hovv = hov(tile);
    const wob = Math.sin(T * 1.4 + i) * (1 - p) * 14;
    const life = Math.sin(T * (0.7 + rnd(i, 7) * 0.5) + i * 1.7);       // nunca se quedan quietas
    const size = 26 + (1 - p) * (14 + rnd(i, 3) * 26) + p * life * 1.6 + hovv * 4;
    const spin = (1 - p) * (rnd(i, 6) * 900 - 450) + Math.sin(T * 0.6 + i) * (1 - p) * 20
      + p * (life * 7 + (T - C.Sitio) * (rnd(i, 8) > 0.5 ? 4 : -4) + hovv * 26);
    const appear = MOTION.pop(0, 1, C.Desorden + rnd(i, 5) * 0.9, C.Desorden + 0.8 + rnd(i, 5) * 0.9)(T);
    out.push(
      <div key={i} style={{
        position: 'absolute',
        left: sx + (tx - sx) * p + wob, top: sy + (ty - sy) * p - wob + p * life * 3 - hovv * 8,
        transform: `rotate(${spin}deg) scale(${appear})`, opacity: opacity * appear,
      }}>
        <Shape kind={Math.floor(rnd(i, 4) * 6)} size={size} color={p > 0.7 ? (i % 5 === 0 || hovv > 0.5 ? accent : SOFT) : STEEL} accent={accent} />
      </div>
    );
  }
  return out;
}

function Suggestions({ T, C, accent }) {
  return (
    <div style={{ position: 'absolute', left: G.sugg.x, top: G.sugg.y, width: G.sugg.w, background: DEEP, border: `1px solid ${LINE}`, boxShadow: '0 30px 60px rgba(0,0,0,0.55)', zIndex: 20 }}>
      {SUGG.map(([name, price], i) => {
        const a = MOTION.enter(0, 1, C.Busqueda + 2.35 + i * 0.12, C.Busqueda + 2.85 + i * 0.12)(T);
        const sel = i === 0 && T > C.Busqueda + 3.15;
        return (
          <div key={name} style={{
            height: G.sugg.h, borderTop: i ? '1px solid #23272d' : 'none', display: 'flex', alignItems: 'center',
            padding: '0 20px', gap: 14, opacity: a, transform: `translateY(${(1 - a) * -10}px)`,
            background: sel ? `color-mix(in oklab, ${accent} 12%, ${DEEP})` : 'transparent',
          }}>
            <span style={{ width: 10, height: 10, background: sel ? accent : '#3a4048' }} />
            <span style={{ font: `500 19px ${SANS}`, color: PAPER, whiteSpace: 'nowrap' }}>{name}</span>
            <span style={{ marginLeft: 'auto', font: `400 17px ${MONO}`, color: sel ? accent : STEEL }}>{price}</span>
          </div>
        );
      })}
    </div>
  );
}

function ProductPanel({ T, C, accent, qty }) {
  const inn = kf(T, [[C.Producto + 0.5, 0], [C.Producto + 1.4, 1], [C.Carrito + 0.7, 1], [C.Carrito + 1.5, 0]], Easing.easeInOutQuart);
  const plusPress = pulse(T, C.Producto + 2.05, 0.22);
  const addPress = pulse(T, C.Producto + 3.7, 0.24);
  const gal = ['1', '2', '3'];
  return (
    <div style={{
      position: 'absolute', left: G.panel.x, top: G.panel.y, width: G.panel.w, height: G.panel.h,
      background: DEEP, borderLeft: `1px solid ${LINE}`, overflow: 'hidden',
      transform: `translateX(${(1 - inn) * 940}px)`, boxShadow: '-40px 0 80px rgba(0,0,0,0.55)', zIndex: 25,
    }}>
      <div style={{ position: 'absolute', left: 48, top: 34, right: 48, display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ font: `400 14px ${MONO}`, color: STEEL, letterSpacing: '0.12em', whiteSpace: 'nowrap' }}>SKU 44-1120 · MARCA PROPIA</span>
        <span style={{ font: `400 18px ${MONO}`, color: STEEL }}>✕</span>
      </div>
      <div style={{ position: 'absolute', left: 48, top: 78, width: 340, height: 300 }}>
        <Placeholder accent={accent} label="foto del producto" style={{ position: 'absolute', inset: 0 }} />
        <div style={{
          position: 'absolute', inset: 0, border: `1px solid ${accent}`, opacity: pulse(T, C.Producto + 1.6, 0.5) * 0.8,
          transform: `scale(${1 + pulse(T, C.Producto + 1.6, 0.5) * 0.02})`,
        }} />
      </div>
      <div style={{ position: 'absolute', left: 48, top: 392, display: 'flex', gap: 10, alignItems: 'center' }}>
        {gal.map((g, i) => (
          <div key={g} style={{
            width: 44, height: 44, border: `1px solid ${i === 0 ? accent : LINE}`, background: PANEL,
            display: 'grid', placeItems: 'center', font: `400 13px ${MONO}`, color: i === 0 ? accent : STEEL,
          }}>{g}</div>
        ))}
        <span style={{ font: `400 12px ${MONO}`, color: STEEL, letterSpacing: '0.1em', marginLeft: 6, whiteSpace: 'nowrap' }}>VISTAS</span>
      </div>
      <div style={{ position: 'absolute', left: 424, top: 78, right: 48 }}>
        <div style={{ font: `700 42px/1.08 ${SANS}`, letterSpacing: '-0.02em', color: PAPER, textWrap: 'balance' }}>Taladro percutor 1/2"</div>
        <div style={{ font: `400 19px ${SANS}`, color: SOFT, marginTop: 12 }}>750 W · velocidad variable · maletín</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 20 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: accent, opacity: 0.5 + Math.sin(T * 4) * 0.5 }} />
          <span style={{ font: `500 15px ${MONO}`, color: accent, letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>EN EXISTENCIA · 8 PZA</span>
        </div>
        <div style={{ font: `700 54px ${SANS}`, color: PAPER, marginTop: 22, letterSpacing: '-0.02em' }}>
          $1,349<span style={{ font: `500 22px ${MONO}`, color: STEEL }}>.00</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {['Factura disponible', 'Envío desde $99'].map(c => (
            <span key={c} style={{ border: `1px solid ${LINE}`, color: SOFT, font: `400 14px ${MONO}`, padding: '7px 11px', whiteSpace: 'nowrap' }}>{c}</span>
          ))}
        </div>
      </div>
      {/* cantidad + agregar (coordenadas fijas: el cursor apunta aquí) */}
      <div style={{ position: 'absolute', left: 48, top: 470, display: 'flex', alignItems: 'center', border: `1px solid ${LINE}`, height: 66 }}>
        {['−', String(qty), '+'].map((c, i) => (
          <span key={i} style={{
            width: 66, height: 66, display: 'grid', placeItems: 'center',
            font: `${i === 1 ? 700 : 400} 24px ${i === 1 ? SANS : MONO}`, color: i === 1 ? PAPER : STEEL,
            borderLeft: i ? `1px solid ${LINE}` : 'none',
            background: i === 2 && plusPress > 0.1 ? '#262b31' : 'transparent',
          }}>{c}</span>
        ))}
      </div>
      <div style={{
        position: 'absolute', left: 262, top: 470, width: 590, height: 66, background: accent, color: DEEP,
        font: `700 22px ${SANS}`, display: 'grid', placeItems: 'center',
        transform: `scale(${1 - addPress * 0.035})`, filter: addPress > 0.25 ? 'brightness(0.85)' : 'none',
      }}>Agregar al carrito</div>
      <div style={{ position: 'absolute', left: 48, right: 48, top: 584, display: 'flex', gap: 40, borderTop: '1px solid #23272d', paddingTop: 24 }}>
        {[['Entrega', 'Hoy antes de 6 pm'], ['Sucursal', 'Centro · Palacios 118'], ['Garantía', '12 meses']].map(([k, v]) => (
          <div key={k}>
            <div style={{ font: `400 13px ${MONO}`, color: STEEL, letterSpacing: '0.12em', whiteSpace: 'nowrap' }}>{k.toUpperCase()}</div>
            <div style={{ font: `500 18px ${SANS}`, color: SOFT, marginTop: 6, whiteSpace: 'nowrap' }}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CartDrawer({ T, C, accent, qty }) {
  const inn = kf(T, [[C.Carrito + 0.05, 0], [C.Carrito + 0.85, 1], [C.Entrega, 1], [C.Entrega + 0.6, 0]], Easing.easeInOutQuart);
  const payPress = pulse(T, C.Carrito + 2.25, 0.24);
  const total = 1349 * qty;
  const rows = [['Taladro percutor 1/2"', qty, 1349 * qty], ['Broca para concreto 1/2"', 2, 156]];
  const sum = total + 156;
  return (
    <div style={{
      position: 'absolute', left: G.cart.x, top: G.cart.y, width: G.cart.w, height: G.cart.h,
      background: '#12151a', borderLeft: `1px solid ${LINE}`, overflow: 'hidden',
      transform: `translateX(${(1 - inn) * 640}px)`, boxShadow: '-40px 0 90px rgba(0,0,0,0.6)', zIndex: 30,
    }}>
      <div style={{ position: 'absolute', left: 40, right: 40, top: 36, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ font: `700 26px ${SANS}`, color: PAPER, whiteSpace: 'nowrap' }}>Tu carrito</span>
        <span style={{ font: `400 14px ${MONO}`, color: STEEL, letterSpacing: '0.1em' }}>{qty + 2} PZA</span>
      </div>
      <div style={{ position: 'absolute', left: 40, right: 40, top: 100 }}>
        {rows.map(([name, q, price], i) => {
          const a = MOTION.enter(0, 1, C.Carrito + 0.6 + i * 0.15, C.Carrito + 1.2 + i * 0.15)(T);
          return (
            <div key={name} style={{
              display: 'flex', gap: 16, alignItems: 'center', padding: '18px 0',
              borderBottom: '1px solid #20242a', opacity: a, transform: `translateX(${(1 - a) * 26}px)`,
            }}>
              <div style={{ position: 'relative', width: 64, height: 64, flexShrink: 0 }}>
                <Placeholder accent={accent} label="" style={{ position: 'absolute', inset: 0, padding: 0 }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: `500 18px ${SANS}`, color: PAPER, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
                <div style={{ font: `400 14px ${MONO}`, color: STEEL, marginTop: 4 }}>{q} × ${(price / q).toFixed(0)}</div>
              </div>
              <div style={{ font: `500 19px ${MONO}`, color: PAPER }}>${price.toLocaleString('en-US')}</div>
            </div>
          );
        })}
      </div>
      <div style={{ position: 'absolute', left: 40, right: 40, top: 292, opacity: MOTION.enter(0, 1, C.Carrito + 0.95, C.Carrito + 1.5)(T) }}>
        <div style={{ font: `400 13px ${MONO}`, color: STEEL, letterSpacing: '0.12em', marginBottom: 12 }}>ENTREGA</div>
        <div style={{ display: 'flex', gap: 10 }}>
          {[['Recoger en sucursal', true], ['Envío a obra', false]].map(([l, on]) => (
            <span key={l} style={{
              flex: 1, textAlign: 'center', padding: '14px 10px', whiteSpace: 'nowrap',
              border: `1px solid ${on ? accent : LINE}`, color: on ? accent : SOFT,
              background: on ? `color-mix(in oklab, ${accent} 10%, transparent)` : 'transparent',
              font: `500 16px ${SANS}`,
            }}>{l}</span>
          ))}
        </div>
      </div>
      <div style={{ position: 'absolute', left: 40, right: 40, top: 430, opacity: MOTION.enter(0, 1, C.Carrito + 1.1, C.Carrito + 1.7)(T) }}>
        {[['Subtotal', `$${sum.toLocaleString('en-US')}`], ['Recolección', 'Sucursal Centro · gratis']].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ font: `400 17px ${SANS}`, color: STEEL, whiteSpace: 'nowrap' }}>{k}</span>
            <span style={{ font: `500 17px ${MONO}`, color: SOFT, whiteSpace: 'nowrap' }}>{v}</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: `1px solid ${LINE}`, paddingTop: 18, marginTop: 8 }}>
          <span style={{ font: `700 24px ${SANS}`, color: PAPER }}>Total</span>
          <span style={{ font: `700 34px ${SANS}`, color: accent }}>${sum.toLocaleString('en-US')}</span>
        </div>
      </div>
      <div style={{
        position: 'absolute', left: 40, top: 670, width: G.cart.w - 80, height: 66, background: accent, color: DEEP,
        font: `700 21px ${SANS}`, display: 'grid', placeItems: 'center',
        transform: `scale(${1 - payPress * 0.035})`, filter: payPress > 0.25 ? 'brightness(0.85)' : 'none',
        opacity: MOTION.enter(0, 1, C.Carrito + 1.3, C.Carrito + 1.8)(T),
      }}>Confirmar pedido</div>
      <div style={{ position: 'absolute', left: 40, top: 756, whiteSpace: 'nowrap', font: `400 14px ${MONO}`, color: STEEL, letterSpacing: '0.06em', opacity: MOTION.enter(0, 1, C.Carrito + 1.5, C.Carrito + 2.0)(T) }}>
        LISTO PARA RECOGER EN 2 H
      </div>
    </div>
  );
}

function OrderCard({ T, C, accent }) {
  const inn = MOTION.pop(0, 1, C.Entrega + 0.25, C.Entrega + 1.1)(T);
  const prog = MOTION.glide(0, 1, C.Entrega + 0.8, C.Entrega + 2.8)(T);
  const fade = MOTION.enter(1, 0, C.Cierre - 0.5, C.Cierre + 0.2)(T);
  return (
    <div style={{
      position: 'absolute', left: 500, top: 400, width: 920, padding: 44, background: PANEL,
      border: '1px solid #343a42', boxShadow: '0 40px 90px rgba(0,0,0,0.6)', zIndex: 35,
      transform: `translateY(${(1 - inn) * 60}px) scale(${0.94 + inn * 0.06})`, opacity: inn * fade,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ font: `400 15px ${MONO}`, color: STEEL, letterSpacing: '0.12em', whiteSpace: 'nowrap' }}>PEDIDO #4821</span>
        <span style={{ font: `500 15px ${MONO}`, color: accent, letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>CONFIRMADO</span>
      </div>
      <div style={{ font: `700 40px ${SANS}`, color: PAPER, marginTop: 16, letterSpacing: '-0.02em' }}>Listo en 2 horas</div>
      <div style={{ font: `400 18px ${SANS}`, color: SOFT, marginTop: 8 }}>Sucursal Centro · Palacios 118 · te avisamos por WhatsApp</div>
      <div style={{ position: 'relative', height: 4, background: LINE, marginTop: 38 }}>
        <div style={{ position: 'absolute', inset: 0, width: `${prog * 100}%`, background: accent }} />
        <div style={{ position: 'absolute', left: `calc(${prog * 100}% - 11px)`, top: -9, width: 22, height: 22, borderRadius: '50%', background: accent, border: `4px solid ${PANEL}` }} />
        {[0, 0.5, 1].map((p, i) => (
          <span key={i} style={{ position: 'absolute', left: `calc(${p * 100}% - 5px)`, top: -3, width: 10, height: 10, borderRadius: '50%', background: prog >= p - 0.02 ? accent : '#41484f' }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
        {['Surtido', 'Empaque', 'Mostrador'].map((s, i) => (
          <span key={s} style={{ font: `500 17px ${SANS}`, color: prog >= i * 0.5 - 0.02 ? PAPER : STEEL, whiteSpace: 'nowrap' }}>{s}</span>
        ))}
      </div>
    </div>
  );
}

function LogoPlate({ T, C, accent }) {
  const inn = MOTION.pop(0, 1, C.Cierre + 0.55, C.Cierre + 1.6)(T);
  const line = MOTION.glide(0, 1, C.Cierre + 1.2, C.Cierre + 2.2)(T);
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 26, opacity: inn,
      transform: `scale(${0.92 + inn * 0.08 + Math.max(0, T - C.Cierre - 1.7) * 0.012}) translateY(${Math.sin(T * 0.5) * 4}px)`,
    }}>
      <HexMark size={110} accent={accent} spin={(1 - inn) * -70 + Math.max(0, T - C.Cierre - 0.9) * 2.4} />
      <div style={{ font: `700 84px ${SANS}`, letterSpacing: '0.1em', color: PAPER, whiteSpace: 'nowrap' }}>FERROPALACIOS</div>
      <div style={{ width: 620 * line, height: 1, background: '#3a4048' }} />
      <div style={{ display: 'flex', gap: 26, opacity: line }}>
        <span style={{ font: `400 20px ${MONO}`, color: STEEL, letterSpacing: '0.16em', whiteSpace: 'nowrap' }}>FERRETERÍA · MATERIAL ELÉCTRICO</span>
        <span style={{ font: `400 20px ${MONO}`, color: accent, letterSpacing: '0.16em', whiteSpace: 'nowrap' }}>ferropalacios.mx</span>
      </div>
    </div>
  );
}

/* ---------- la pieza ---------- */

function Piece({ accent, showGrid }) {
  const { T, CUES: C } = useComposition();

  /* cámara */
  const scale = kf(T, [
    [0, 1.14], [C.Desorden, 1.0], [C.Sitio - 0.2, 1.0], [C.Sitio + 1.8, 0.74],
    [C.Catalogo + 0.8, 1.02], [C.Busqueda + 0.5, 1.02], [C.Busqueda + 1.4, 1.22],
    [C.Busqueda + 3.4, 1.22], [C.Producto + 0.6, 0.9], [C.Producto + 1.8, 1.22],
    [C.Carrito + 0.2, 1.22], [C.Carrito + 1.0, 1.1], [C.Entrega + 0.2, 1.1],
    [C.Entrega + 1.2, 0.95], [C.Cierre - 0.2, 0.97], [C.Cierre + 1.4, 0.7], [C.Cierre + 3.8, 0.745],
  ]);
  const fx = kf(T, [
    [0, 960], [C.Sitio + 1.8, 960], [C.Catalogo + 0.8, 900], [C.Busqueda + 1.4, 600],
    [C.Busqueda + 3.4, 600], [C.Producto + 0.6, 1000], [C.Producto + 1.8, 1290],
    [C.Carrito + 1.0, 1420], [C.Entrega + 0.2, 1420], [C.Entrega + 1.2, 960], [C.Cierre + 1.4, 960],
  ]);
  const fy = kf(T, [
    [0, 540], [C.Sitio + 1.8, 560], [C.Catalogo + 0.8, 760], [C.Busqueda + 1.4, 380],
    [C.Busqueda + 3.4, 400], [C.Producto + 0.6, 600], [C.Producto + 1.8, 560],
    [C.Carrito + 1.0, 580], [C.Entrega + 0.2, 580], [C.Entrega + 1.2, 500], [C.Cierre + 1.4, 540],
  ]);
  const drift = Math.sin(T * 0.31) * 7;

  const gridOp = kf(T, [[0, 0.85], [C.Desorden, 0.7], [C.Sitio + 1.2, 0.2], [C.Cierre + 0.6, 0.5]], Easing.easeOutCubic);
  const partsOp = kf(T, [[C.Desorden - 0.2, 0], [C.Desorden + 0.2, 1], [C.Producto + 0.4, 1], [C.Producto + 1.2, 0.9], [C.Cierre - 0.6, 0.9]], Easing.easeOutCubic);
  const siteFade = kf(T, [[C.Cierre - 0.15, 1], [C.Cierre + 0.55, 0]], Easing.easeInOutQuart);

  /* apertura */
  const openOp = kf(T, [[0, 1], [C.Desorden + 0.2, 1], [C.Desorden + 1.0, 0]], Easing.easeOutCubic);
  const word = 'FERROPALACIOS'.split('');

  /* interacción: cursor anclado a los controles reales */
  const CLICKS = [C.Busqueda + 0.95, C.Busqueda + 3.35, C.Producto + 2.05, C.Producto + 3.7, C.Carrito + 2.25];
  const path = [
    [C.Catalogo - 0.4, [1780, 1070]],
    [C.Catalogo + 0.9, HOT.tile(1)],
    [C.Catalogo + 2.0, HOT.tile(2)],
    [C.Catalogo + 3.1, HOT.tile(4)],
    [C.Busqueda + 0.85, HOT.search],
    [C.Busqueda + 3.25, HOT.sugg],
    [C.Producto + 1.95, HOT.plus],
    [C.Producto + 3.6, HOT.add],
    [C.Carrito + 2.15, HOT.pay],
    [C.Entrega + 0.5, [1700, 1050]],
  ];
  const cx = kf(T, path.map(([t, p]) => [t, p[0]]), Easing.easeInOutCubic);
  const cy = kf(T, path.map(([t, p]) => [t, p[1]]), Easing.easeInOutCubic);
  const press = CLICKS.reduce((m, t) => Math.max(m, pulse(T, t + 0.12, 0.22)), 0);
  const curOp = kf(T, [[C.Catalogo - 0.6, 0], [C.Catalogo - 0.1, 1], [C.Entrega + 0.2, 1], [C.Entrega + 0.7, 0]], Easing.easeOutCubic);

  /* estado derivado del tiempo */
  const hovWin = { 1: [C.Catalogo + 0.8, C.Catalogo + 1.9], 2: [C.Catalogo + 1.9, C.Catalogo + 3.0], 4: [C.Catalogo + 3.0, C.Busqueda + 0.6] };
  const hov = i => {
    const w = hovWin[i];
    if (!w) return 0;
    return kf(T, [[w[0] - 0.28, 0], [w[0] + 0.06, 1], [w[1] - 0.06, 1], [w[1] + 0.28, 0]], Easing.easeInOutCubic);
  };
  const typedN = Math.floor(clamp((T - (C.Busqueda + 1.1)) / 1.35, 0, 1) * QUERY.length);
  const typed = T > C.Busqueda + 0.95 ? QUERY.slice(0, typedN) : '';
  const caret = T > C.Busqueda + 0.9 && T < C.Producto + 0.2 ? (Math.sin(T * 7) > -0.2 ? 1 : 0.1) : 0;
  const results = T > C.Busqueda + 2.4 ? 18 : 0;
  const qty = T > C.Producto + 2.05 ? 2 : 1;
  const cart = T > C.Producto + 3.7 ? 3 : 1;

  return (
    <div data-screen-label={`t=${Math.floor(T)}s`} style={{ position: 'absolute', inset: 0, background: DEEP, overflow: 'hidden' }}>
      {showGrid && (
        <div style={{
          position: 'absolute', inset: -200, opacity: gridOp,
          backgroundImage: `linear-gradient(${INK} 1px, transparent 1px), linear-gradient(90deg, ${INK} 1px, transparent 1px), linear-gradient(rgba(126,136,148,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(126,136,148,0.10) 1px, transparent 1px)`,
          backgroundSize: '240px 240px, 240px 240px, 48px 48px, 48px 48px',
          backgroundPosition: `${drift * 2}px ${drift}px`,
        }} />
      )}
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(120% 90% at 50% 40%, transparent 30%, ${DEEP} 100%)` }} />

      <div style={{
        position: 'absolute', left: 0, top: 0, width: 1920, height: 1080, transformOrigin: '0 0',
        transform: `translate(${960 - fx * scale + drift}px, ${540 - fy * scale + drift * 0.6}px) scale(${scale})`,
      }}>
        <div style={{ opacity: siteFade }}>
          <Site T={T} C={C} accent={accent} cartCount={cart} typed={typed} caret={caret} results={results} />
          <Tiles T={T} C={C} accent={accent} hov={hov} />
          <Parts T={T} C={C} accent={accent} opacity={partsOp} hov={hov} />
          <Shot from={C.Busqueda + 2.3} to={C.Producto + 0.55}>
            <Suggestions T={T} C={C} accent={accent} />
          </Shot>
          <Shot from={C.Producto + 0.4} to={C.Carrito + 1.6}>
            <ProductPanel T={T} C={C} accent={accent} qty={qty} />
          </Shot>
          <Shot from={C.Carrito} to={C.Entrega + 0.7}>
            <CartDrawer T={T} C={C} accent={accent} qty={qty} />
          </Shot>
          <Shot from={C.Entrega + 0.1} to={C.Cierre + 0.3}>
            <div style={{
              position: 'absolute', left: W.x, top: W.y + 58, width: W.w, height: W.h - 58,
              background: 'rgba(6,7,9,0.66)', zIndex: 34,
              opacity: kf(T, [[C.Entrega + 0.15, 0], [C.Entrega + 0.8, 1], [C.Cierre - 0.5, 1], [C.Cierre + 0.1, 0]], Easing.easeOutCubic),
            }} />
            <OrderCard T={T} C={C} accent={accent} />
          </Shot>
        </div>
        <Shot from={C.Catalogo - 0.6} to={C.Entrega + 0.8}>
          <Cursor x={cx} y={cy} press={press} opacity={curOp} />
        </Shot>
      </div>

      <Shot from={0} to={C.Desorden + 1.1}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 34, opacity: openOp }}>
          <div style={{ transform: `scale(${MOTION.pop(0.3, 1, 0.1, 1.3)(T)})`, opacity: MOTION.enter(0, 1, 0.1, 0.9)(T) }}>
            <HexMark size={120} accent={accent} spin={kf(T, [[0, -120], [1.6, 0], [C.Desorden + 1, 30]], Easing.easeOutCubic)} />
          </div>
          <div style={{ display: 'flex' }}>
            {word.map((ch, i) => {
              const a = MOTION.enter(0, 1, 0.5 + i * 0.055, 1.2 + i * 0.055)(T);
              return (
                <span key={i} style={{
                  font: `700 76px ${SANS}`, letterSpacing: '0.12em', color: PAPER, display: 'inline-block',
                  opacity: a, transform: `translateY(${(1 - a) * 52}px) rotate(${(1 - a) * -8}deg)`,
                }}>{ch}</span>
              );
            })}
          </div>
          <div style={{ font: `400 20px ${MONO}`, letterSpacing: '0.28em', color: STEEL, opacity: MOTION.enter(0, 1, 1.4, 2.2)(T), whiteSpace: 'nowrap' }}>
            FERRETERÍA · DESDE 1978
          </div>
        </div>
      </Shot>

      <Shot from={C.Cierre + 0.5} to={999}>
        <LogoPlate T={T} C={C} accent={accent} />
      </Shot>

      <div style={{ position: 'absolute', inset: 0, opacity: 0.055, pointerEvents: 'none', background: `repeating-linear-gradient(112deg, ${PAPER} 0 1px, transparent 1px 4px)` }} />
      <div style={{ position: 'absolute', inset: 0, border: '1px solid rgba(126,136,148,0.16)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: 40, bottom: 34, display: 'flex', gap: 16, alignItems: 'center', opacity: 0.65 }}>
        <span style={{ width: 26, height: 2, background: accent }} />
        <span style={{ font: `400 15px ${MONO}`, letterSpacing: '0.2em', color: STEEL, whiteSpace: 'nowrap' }}>FERROPALACIOS.MX</span>
      </div>
    </div>
  );
}

function FerroApp() {
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  return (
    <React.Fragment>
      <CompositionStage width={1920} height={1080} bg={DEEP}
        scenes={window.OM_SCENES} playback={window.OM_PLAYBACK}>
        <Piece accent={t.accent} showGrid={t.cuadricula} />
      </CompositionStage>
      <TweaksPanel>
        <TweakSection label="Identidad" />
        <TweakColor label="Acento" value={t.accent}
          options={['oklch(0.75 0.18 130)', 'oklch(0.75 0.18 75)', 'oklch(0.72 0.19 45)', 'oklch(0.72 0.14 235)']}
          onChange={v => setTweak('accent', v)} />
        <TweakSection label="Escena" />
        <TweakToggle label="Cuadrícula de plano" value={t.cuadricula} onChange={v => setTweak('cuadricula', v)} />
        <TweakToggle label="Motion editor" value={t.motionEditor} onChange={v => setTweak('motionEditor', v)} />
      </TweaksPanel>
    </React.Fragment>
  );
}

window.FerroApp = FerroApp;
