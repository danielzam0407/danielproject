/* Novatek — panel de inventario administrado por un agente.
   Una sola composición: un tablero grande y una cámara que lo recorre. */

const {
  useComposition, animate, Easing, clamp, Captions,
} = window;

/* ── Motion: exactamente tres helpers ─────────────────────────────── */
const MOTION = {
  enter: (start, dur) => animate({ from: 0, to: 1, start, end: start + (dur || 0.6), ease: Easing.easeOutCubic }),
  draw: (start, dur) => animate({ from: 0, to: 1, start, end: start + (dur || 1.2), ease: Easing.easeInOutCubic }),
  pop: (start, dur) => animate({ from: 0, to: 1, start, end: start + (dur || 0.5), ease: Easing.easeOutBack }),
};
const en = (T, s, d) => MOTION.enter(s, d)(T);
const dr = (T, s, d) => MOTION.draw(s, d)(T);
const po = (T, s, d) => MOTION.pop(s, d)(T);

const BOARD_W = 3600;
const BOARD_H = 1990;
const ORDER = ['Apertura', 'Overview', 'Catalogo', 'StockAlerta', 'OrdenCompra',
  'Movimientos', 'Racks', 'Lotes', 'Reportes', 'AgenteChat', 'Cierre'];

const VIEWS = {
  Apertura: { cx: 1800, cy: 995, s: 0.50 },
  Overview: { cx: 1120, cy: 330, s: 0.78 },
  Catalogo: { cx: 850, cy: 752, s: 1.30 },
  StockAlerta: { cx: 2005, cy: 752, s: 1.32 },
  OrdenCompra: { cx: 3075, cy: 752, s: 1.44 },
  Movimientos: { cx: 730, cy: 1266, s: 1.48 },
  Racks: { cx: 1735, cy: 1266, s: 1.40 },
  Lotes: { cx: 2675, cy: 1266, s: 1.52 },
  Reportes: { cx: 920, cy: 1726, s: 1.36 },
  AgenteChat: { cx: 1480, cy: 1360, s: 0.80 },
  Cierre: { cx: 1800, cy: 995, s: 0.50 },
};

/* algunas escenas terminan en otro encuadre (paneo) en vez de solo derivar */
const VIEWS_END = {
  Overview: { cx: 2760, cy: 340, s: 0.78 },
};

const RETICLE = {
  Overview: { x: 3300, y: 392, on: 1 },
  Catalogo: { x: 1120, y: 900, on: 1 },
  StockAlerta: { x: 2352, y: 852, on: 1 },
  OrdenCompra: { x: 3400, y: 946, on: 1 },
  Movimientos: { x: 700, y: 1400, on: 1 },
  Racks: { x: 1330, y: 1424, on: 1 },
  Lotes: { x: 2960, y: 1252, on: 1 },
  Reportes: { x: 496, y: 1700, on: 1 },
  AgenteChat: { x: 1330, y: 1790, on: 0 },
  Cierre: { x: 1800, y: 995, on: 0 },
  Apertura: { x: 1800, y: 995, on: 0 },
};

const NAV = [
  ['Resumen', 'Overview'], ['Catálogo', 'Catalogo'], ['Stock & mínimos', 'StockAlerta'],
  ['Órdenes de compra', 'OrdenCompra'], ['Movimientos', 'Movimientos'], ['Scan', 'Movimientos'],
  ['Ubicaciones', 'Racks'], ['Lotes & caducidad', 'Lotes'], ['Reportes', 'Reportes'],
  ['Facturación', 'AgenteChat'], ['Usuarios', 'AgenteChat'], ['Auditoría', 'Cierre'],
];

const PALETTES = {
  papel: {
    bg: '#f2f2f3', grid: 'rgba(29,31,32,0.05)', ink: '#1d1f20', mut: '#7a7a7d',
    line: 'rgba(29,31,32,0.18)', line2: 'rgba(29,31,32,0.34)', mark: 'rgba(29,31,32,0.5)',
    accent: '#5980a6', deep: '#416180', steel: '#1d2d3d', soft: '#eef6ff',
    panel: 'rgba(255,255,255,0.55)', side: '#1d2d3d', sideInk: '#e9edf2',
    plate: '#f5f5f8', halo: '#f2f2f3', flagBg: '#2c455d', flagInk: '#eef6ff',
    noteShadow: '0 6px 20px rgba(43,43,45,0.16)',
  },
  acero: {
    bg: '#16222e', grid: 'rgba(233,237,242,0.055)', ink: '#eef2f6', mut: '#9ebbd8',
    line: 'rgba(158,187,216,0.24)', line2: 'rgba(158,187,216,0.44)', mark: 'rgba(158,187,216,0.6)',
    accent: '#94bce3', deep: '#b5d9fd', steel: '#0f1922', soft: '#22364a',
    panel: 'rgba(255,255,255,0.03)', side: '#0f1922', sideInk: '#e9edf2',
    plate: '#1d2d3d', halo: '#16222e', flagBg: '#94bce3', flagInk: '#0f1922',
    noteShadow: '0 6px 20px rgba(0,0,0,0.45)',
  },
};

const HEAD = '"Barlow Condensed", system-ui, sans-serif';
const BODY = '"Barlow", system-ui, sans-serif';
const fmt = (n) => Math.round(n).toLocaleString('es-MX');
const rnd = (i) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); };

function kf(T, keys) {
  if (T <= keys[0].t) return keys[0].v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (T >= a.t && T <= b.t) {
      const p = Easing.easeInOutCubic(clamp((T - a.t) / Math.max(0.001, b.t - a.t), 0, 1));
      const out = {};
      for (const k in a.v) out[k] = a.v[k] + (b.v[k] - a.v[k]) * p;
      return out;
    }
  }
  return keys[keys.length - 1].v;
}

/* ── Piezas de chrome ─────────────────────────────────────────────── */
function Marks({ c }) {
  const pos = [{ top: -6, left: -6 }, { top: -6, right: -6 }, { bottom: -6, left: -6 }, { bottom: -6, right: -6 }];
  return (
    <React.Fragment>
      {pos.map((p, i) => (
        <div key={i} style={Object.assign({ position: 'absolute', width: 11, height: 11 }, p)}>
          <div style={{ position: 'absolute', left: 5, top: 0, width: 1, height: 11, background: c }} />
          <div style={{ position: 'absolute', top: 5, left: 0, width: 11, height: 1, background: c }} />
        </div>
      ))}
    </React.Fragment>
  );
}

function Panel({ x, y, w, h, kicker, title, right, glow, P, appear, children }) {
  const g = glow || 0;
  return (
    <div style={{
      position: 'absolute', left: x, top: y, width: w, height: h,
      border: `1px solid ${g > 0.02 ? P.accent : P.line}`,
      background: P.panel,
      opacity: 0.06 + 0.94 * (appear == null ? 1 : appear),
      transform: `translateY(${(1 - (appear == null ? 1 : appear)) * 22}px)`,
      boxShadow: g > 0.02 ? `0 0 0 ${(2 * g).toFixed(2)}px ${P.accent}22, 0 0 ${(40 * g).toFixed(0)}px ${P.accent}1f` : 'none',
    }}>
      <Marks c={P.mark} />
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 16, padding: '18px 26px 0 26px',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: `500 15px ${BODY}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: P.mut }}>{kicker}</div>
          <div style={{ font: `600 30px ${HEAD}`, color: P.ink, letterSpacing: '-0.01em', lineHeight: 1.1 }}>{title}</div>
        </div>
        {right}
      </div>
      <div style={{ position: 'absolute', left: 26, right: 26, top: 92, bottom: 22 }}>{children}</div>
    </div>
  );
}

function Tag({ children, P, solid, dim }) {
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px 2px',
      font: `500 15px ${BODY}`, letterSpacing: '0.08em', textTransform: 'uppercase',
      color: solid ? P.flagInk : (dim ? P.mut : P.deep),
      background: solid ? P.flagBg : 'transparent',
      border: solid ? 'none' : `1px solid ${dim ? P.line : P.accent}`,
      whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

/* Nota del agente — placa opaca para que siempre se lea sobre el tablero */
function Note({ children, P, style, wrap }) {
  return (
    <div style={Object.assign({
      display: 'flex', alignItems: 'center', gap: 12,
      background: P.plate, border: `1px solid ${P.accent}`,
      padding: '9px 14px', boxShadow: P.noteShadow,
    }, style)}>
      <span style={{
        background: P.accent, color: '#ffffff', padding: '2px 9px 1px',
        font: `600 18px ${HEAD}`, letterSpacing: '0.16em', textTransform: 'uppercase', whiteSpace: 'nowrap',
      }}>Mario</span>
      <span style={{ font: `500 20px ${BODY}`, color: P.ink, whiteSpace: wrap ? 'normal' : 'nowrap', lineHeight: 1.3 }}>{children}</span>
    </div>
  );
}

function Bar({ v, w, P, alert }) {
  return (
    <div style={{ position: 'relative', width: w, height: 12, border: `1px solid ${P.line}` }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: `${clamp(v, 0, 1) * 100}%`,
        background: alert ? P.flagBg : P.accent,
      }} />
    </div>
  );
}

/* ── Panel: KPIs ──────────────────────────────────────────────────── */
const KPIS = [
  { k: 'SKUs activos', v: 1284, dec: 0, suf: '', d: '+18 este mes' },
  { k: 'Stock total', v: 412860, dec: 0, suf: ' pz', d: '+4.2% vs. julio' },
  { k: 'Valor inventario', v: 8.42, dec: 2, suf: 'M', pre: '$', d: 'MXN · costo promedio' },
  { k: 'Rotación mensual', v: 3.4, dec: 1, suf: '×', d: 'meta 3.0×' },
  { k: 'Alertas de mínimo', v: 6, dec: 0, suf: '', d: '5 resueltas por Mario' },
];

function KpiRow({ T, P, B, glow }) {
  const s = B.Apertura.s;
  const w = 640, gap = 20;
  return KPIS.map((kpi, i) => {
    const a = en(T, s + 1.5 + i * 0.16, 0.7);
    const cnt = dr(T, B.Overview.s - 0.6 + i * 0.12, 1.5);
    const val = kpi.v * (0.05 + 0.95 * cnt);
    const alert = i === 4;
    const pulse = alert ? 0.5 + 0.5 * Math.sin(T * 3.4) : 0;
    return (
      <div key={i} style={{
        position: 'absolute', left: 280 + i * (w + gap), top: 150, width: w, height: 320,
        border: `1px solid ${alert && glow > 0.02 ? P.accent : P.line}`, background: P.panel,
        opacity: 0.05 + 0.95 * a, transform: `translateY(${(1 - a) * 26}px)`,
        boxShadow: glow > 0.02 ? `0 0 ${(30 * glow).toFixed(0)}px ${P.accent}1c` : 'none',
      }}>
        <Marks c={P.mark} />
        <div style={{ padding: '22px 26px' }}>
          <div style={{ font: `500 17px ${BODY}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: P.mut }}>{kpi.k}</div>
          <div style={{
            font: `600 84px ${HEAD}`, lineHeight: 1.02, marginTop: 14,
            color: alert ? P.deep : P.ink, fontVariantNumeric: 'tabular-nums',
            textShadow: alert ? `0 0 ${(18 * pulse).toFixed(0)}px ${P.accent}` : 'none',
          }}>
            {(kpi.pre || '')}{kpi.dec ? val.toFixed(kpi.dec) : fmt(val)}{kpi.suf}
          </div>
          <div style={{ font: `400 19px ${BODY}`, color: P.mut, marginTop: 6 }}>{kpi.d}</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, marginTop: 22, height: 66 }}>
            {Array.from({ length: 18 }).map((_, j) => {
              const h = (0.25 + 0.75 * rnd(i * 31 + j)) * 66 * clamp(cnt * 1.4 - j * 0.03, 0, 1);
              return <div key={j} style={{ width: 26, height: Math.max(2, h), background: j > 14 ? P.accent : `${P.accent}59` }} />;
            })}
          </div>
        </div>
      </div>
    );
  });
}

/* ── Panel: catálogo ──────────────────────────────────────────────── */
const CAT = [
  ['BOL-CAM-40', 'Bolsa camiseta 40×50', '12,400 pz'],
  ['BOL-VAC-25', 'Bolsa al vacío 25×35', '3,180 pz'],
  ['VAS-PET-16', 'Vaso PET 16 oz', '48,600 pz'],
  ['VAS-POL-12', 'Vaso poliestireno 12 oz', '21,050 pz'],
  ['CTR-DOM-32', 'Contenedor domo 32 oz', '9,700 pz'],
  ['CHR-FOO-08', 'Charola grado alimenticio', '6,240 pz'],
  ['CAJ-ALM-60', 'Caja almacén 60×40×32', '2,860 pz'],
  ['CAJ-INV-24', 'Caja inventario 24 L', '1,410 pz'],
  ['PLA-STR-50', 'Playo stretch 50 cm', '780 rollos'],
];

function CatalogoBody({ T, P, B }) {
  const tw = 348, th = 118, gx = 20, gy = 12;
  return (
    <React.Fragment>
      {CAT.map((it, i) => {
        const col = i % 3, row = (i / 3) | 0;
        const a = en(T, B.Catalogo.s - 1.4 + i * 0.09, 0.6);
        const hi = clamp(Math.sin(clamp((T - (B.Catalogo.s + 1.2 + i * 0.12)) / 0.5, 0, 1) * Math.PI), 0, 1);
        return (
          <div key={i} style={{
            position: 'absolute', left: col * (tw + gx), top: row * (th + gy), width: tw, height: th,
            border: `1px solid ${P.line}`, display: 'flex', gap: 14, padding: 12,
            opacity: 0.04 + 0.96 * a, transform: `translateX(${(1 - a) * -18}px)`,
            background: hi > 0.02 ? `${P.accent}14` : 'transparent',
          }}>
            <div style={{
              width: 96, height: 96, border: `1px solid ${P.line2}`,
              backgroundImage: `repeating-linear-gradient(135deg, ${P.accent}3d 0 2px, transparent 2px 7px)`,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: `500 16px ${BODY}`, letterSpacing: '0.1em', color: P.deep }}>{it[0]}</div>
              <div style={{ font: `500 21px ${HEAD}`, color: P.ink, lineHeight: 1.15, marginTop: 2 }}>{it[1]}</div>
              <div style={{ font: `400 18px ${BODY}`, color: P.mut, marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>{it[2]}</div>
            </div>
          </div>
        );
      })}
    </React.Fragment>
  );
}

/* ── Panel: stock y alertas ───────────────────────────────────────── */
const STOCK = [
  ['VAS-PET-16', 'Vaso PET 16 oz', 48600, 20000],
  ['BOL-CAM-40', 'Bolsa camiseta 40×50', 12400, 6000],
  ['VAS-POL-12', 'Vaso poliestireno 12 oz', 21050, 18000],
  ['CAJ-ALM-60', 'Caja almacén 60×40×32', 2860, 1500],
  ['PLA-STR-50', 'Playo stretch 50 cm', 780, 600],
];

function StockBody({ T, P, B }) {
  const s = B.StockAlerta.s;
  const drop = dr(T, s + 1.0, 1.6);
  const cols = [180, 300, 150, 120, 200, 120];
  return (
    <React.Fragment>
      <div style={{ display: 'flex', gap: 18, paddingBottom: 8, borderBottom: `1px solid ${P.line2}` }}>
        {['SKU', 'Producto', 'Stock', 'Mínimo', 'Nivel', 'Estado'].map((h, i) => (
          <div key={i} style={{ width: cols[i], font: `500 15px ${BODY}`, letterSpacing: '0.12em', textTransform: 'uppercase', color: P.mut }}>{h}</div>
        ))}
      </div>
      {STOCK.map((r, i) => {
        const a = en(T, B.Catalogo.s - 1.0 + i * 0.1, 0.6);
        const falling = i === 2;
        const stock = falling ? r[2] - 5400 * drop : r[2];
        const below = falling && stock < r[3];
        const alertA = below ? po(T, s + 2.0, 0.55) : 0;
        const pulse = 0.5 + 0.5 * Math.sin(T * 4.2);
        return (
          <div key={i} style={{
            display: 'flex', gap: 18, alignItems: 'center', height: 60,
            borderBottom: `1px solid ${P.line}`, opacity: 0.05 + 0.95 * a,
            background: below ? `${P.accent}${alertA > 0.5 ? '1f' : '10'}` : 'transparent',
          }}>
            <div style={{ width: cols[0], font: `500 18px ${BODY}`, letterSpacing: '0.08em', color: P.deep }}>{r[0]}</div>
            <div style={{ width: cols[1], font: `500 22px ${HEAD}`, color: P.ink }}>{r[1]}</div>
            <div style={{ width: cols[2], font: `500 22px ${BODY}`, color: P.ink, fontVariantNumeric: 'tabular-nums' }}>{fmt(stock)}</div>
            <div style={{ width: cols[3], font: `400 20px ${BODY}`, color: P.mut, fontVariantNumeric: 'tabular-nums' }}>{fmt(r[3])}</div>
            <div style={{ width: cols[4] }}><Bar v={stock / (r[2] * 1.25)} w={cols[4]} P={P} alert={below} /></div>
            <div style={{ width: cols[5], transform: `scale(${below ? 0.7 + 0.3 * alertA : 1})`, transformOrigin: 'left center' }}>
              {below
                ? <span style={{ opacity: 0.55 + 0.45 * pulse }}><Tag P={P} solid>Bajo mínimo</Tag></span>
                : <Tag P={P} dim>Óptimo</Tag>}
            </div>
          </div>
        );
      })}
      <div style={{ marginTop: 14, opacity: po(T, B.StockAlerta.s + 2.9, 0.6) }}>
        <Note P={P}>Consumo 3× arriba del promedio. Punto de reorden alcanzado.</Note>
      </div>
    </React.Fragment>
  );
}

/* ── Panel: orden de compra ───────────────────────────────────────── */
const OC = [
  ['VAS-POL-12', 'Vaso poliestireno 12 oz', '24,000 pz', '$0.41', '$9,840.00'],
  ['TAP-PET-16', 'Tapa PET 16 oz', '18,000 pz', '$0.19', '$3,420.00'],
  ['PLA-STR-50', 'Playo stretch 50 cm', '240 rollos', '$78.00', '$18,720.00'],
];

function OcBody({ T, P, B }) {
  const s = B.OrdenCompra.s;
  const stamp = po(T, s + 2.9, 0.6);
  const sheet = en(T, s - 0.4, 0.7);
  return (
    <div style={{
      position: 'absolute', inset: 0, border: `1px solid ${P.line2}`, background: P.plate,
      padding: '22px 26px', opacity: 0.04 + 0.96 * sheet,
      transform: `translateY(${(1 - sheet) * 30}px)`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ font: `600 34px ${HEAD}`, color: P.ink }}>OC-2418</div>
          <div style={{ font: `400 18px ${BODY}`, color: P.mut, whiteSpace: 'nowrap' }}>Polímeros del Bajío S.A. · crédito 30 días</div>
        </div>
        <Tag P={P} solid>Auto</Tag>
      </div>
      <div style={{ height: 1, background: P.line2, margin: '16px 0' }} />
      {OC.map((l, i) => {
        const a = en(T, s + 0.6 + i * 0.45, 0.5);
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12, height: 46,
            borderBottom: `1px solid ${P.line}`, opacity: a, transform: `translateX(${(1 - a) * 16}px)`,
          }}>
            <div style={{ width: 170, font: `500 18px ${BODY}`, letterSpacing: '0.08em', color: P.deep }}>{l[0]}</div>
            <div style={{ flex: 1, font: `500 21px ${HEAD}`, color: P.ink }}>{l[1]}</div>
            <div style={{ width: 150, textAlign: 'right', font: `400 20px ${BODY}`, color: P.ink, fontVariantNumeric: 'tabular-nums' }}>{l[2]}</div>
            <div style={{ width: 90, textAlign: 'right', font: `400 20px ${BODY}`, color: P.mut, fontVariantNumeric: 'tabular-nums' }}>{l[3]}</div>
            <div style={{ width: 140, textAlign: 'right', font: `500 21px ${BODY}`, color: P.ink, fontVariantNumeric: 'tabular-nums' }}>{l[4]}</div>
          </div>
        );
      })}
      <div style={{ position: 'absolute', right: 26, bottom: 52, textAlign: 'right' }}>
        <div style={{ font: `500 19px ${BODY}`, letterSpacing: '0.1em', textTransform: 'uppercase', color: P.mut }}>Total</div>
        <div style={{ font: `600 52px ${HEAD}`, color: P.ink, fontVariantNumeric: 'tabular-nums', lineHeight: 1.05 }}>${fmt(31980 * dr(T, s + 1.6, 1.0))}.00</div>
      </div>
      <div style={{
        position: 'absolute', left: 26, bottom: 8, right: 26, display: 'flex', alignItems: 'center', gap: 18,
        opacity: stamp, transform: `scale(${0.86 + 0.14 * stamp})`, transformOrigin: 'left bottom',
      }}>
        <div style={{
          border: `2px solid ${P.accent}`, padding: '6px 14px 4px',
          font: `600 26px ${HEAD}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: P.deep,
          transform: 'rotate(-3deg)',
        }}>Enviada a proveedor</div>
        <Note P={P}>Generada y autorizada · 08:41</Note>
      </div>
    </div>
  );
}

/* ── Panel: movimientos + scan ────────────────────────────────────── */
const MOVS = [
  ['08:12', 'ent', 'VAS-PET-16', '+2,400 pz', 'Rack B-04'],
  ['08:26', 'sal', 'BOL-CAM-40', '−1,800 pz', 'Pedido 7712'],
  ['08:33', 'sal', 'VAS-POL-12', '−5,400 pz', 'Pedido 7715'],
  ['08:47', 'ent', 'CAJ-ALM-60', '+600 pz', 'Rack D-02'],
];

function MovBody({ T, P, B }) {
  const s = B.Movimientos.s;
  const beam = clamp((T - (s + 0.9)) / 1.5, 0, 1);
  const hit = po(T, s + 2.5, 0.5);
  return (
    <React.Fragment>
      {MOVS.map((m, i) => {
        const a = en(T, s - 1.6 + i * 0.12, 0.6);
        const isNew = i === 3;
        const na = isNew ? po(T, s + 2.7, 0.6) : 1;
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 14, height: 48,
            borderBottom: `1px solid ${P.line}`, opacity: (0.05 + 0.95 * a) * (isNew ? na : 1),
            background: isNew && na > 0.3 ? `${P.accent}14` : 'transparent',
          }}>
            <div style={{ width: 74, font: `400 19px ${BODY}`, color: P.mut, fontVariantNumeric: 'tabular-nums' }}>{m[0]}</div>
            <div style={{
              width: 26, height: 26, border: `1px solid ${P.accent}`, color: P.deep,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              font: `500 17px ${BODY}`,
            }}>{m[1] === 'ent' ? '↓' : '↑'}</div>
            <div style={{ width: 170, font: `500 18px ${BODY}`, letterSpacing: '0.08em', color: P.deep }}>{m[2]}</div>
            <div style={{ width: 150, font: `500 21px ${BODY}`, color: P.ink, fontVariantNumeric: 'tabular-nums' }}>{m[3]}</div>
            <div style={{ flex: 1, font: `400 19px ${BODY}`, color: P.mut, textAlign: 'right' }}>{m[4]}</div>
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 150, border: `1px solid ${P.line2}`, padding: 16, display: 'flex', gap: 20, alignItems: 'center' }}>
        <div style={{ position: 'relative', width: 300, height: 96, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 96 }}>
            {Array.from({ length: 42 }).map((_, j) => (
              <div key={j} style={{ width: rnd(j) > 0.6 ? 6 : 3, height: 96, background: P.ink, opacity: 0.82 }} />
            ))}
          </div>
          <div style={{
            position: 'absolute', top: -8, bottom: -8, left: `${beam * 100}%`, width: 4,
            background: P.accent, boxShadow: `0 0 26px 10px ${P.accent}80`, opacity: beam > 0 && beam < 1 ? 1 : 0,
          }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ font: `500 15px ${BODY}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: P.mut }}>Lectura de código</div>
          <div style={{ font: `600 30px ${HEAD}`, color: P.ink, opacity: 0.25 + 0.75 * hit }}>
            {hit > 0.2 ? 'CAJ-ALM-60 · 600 pz · Rack D-02' : 'Esperando escaneo…'}
          </div>
          <div style={{ marginTop: 8, opacity: hit }}><Tag P={P} solid>Entrada registrada</Tag></div>
        </div>
      </div>
    </React.Fragment>
  );
}

/* ── Panel: racks ─────────────────────────────────────────────────── */
function RacksBody({ T, P, B }) {
  const s = B.Racks.s;
  const rows = 6, cols = 8, cw = 82, ch = 50, g = 5;
  const move = dr(T, s + 1.3, 1.7);
  const src = { r: 1, c: 2 }, dst = { r: 4, c: 6 };
  const mx = (src.c + (dst.c - src.c) * move) * (cw + g) + cw / 2;
  const my = (src.r + (dst.r - src.r) * move) * (ch + g) + ch / 2;
  return (
    <React.Fragment>
      <div style={{ position: 'relative', width: cols * (cw + g) - g, height: rows * (ch + g) - g }}>
        {Array.from({ length: rows * cols }).map((_, i) => {
          const r = (i / cols) | 0, c = i % cols;
          const lvl = 0.15 + 0.85 * rnd(i * 7.3);
          const a = en(T, s - 1.8 + i * 0.012, 0.5);
          const isSrc = r === src.r && c === src.c, isDst = r === dst.r && c === dst.c;
          const flag = (isSrc && move < 1) || (isDst && move > 0.05);
          return (
            <div key={i} style={{
              position: 'absolute', left: c * (cw + g), top: r * (ch + g), width: cw, height: ch,
              border: `1px solid ${flag ? P.accent : P.line}`, opacity: 0.06 + 0.94 * a,
              display: 'flex', alignItems: 'flex-end',
            }}>
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${lvl * 100}%`, background: `${P.accent}${flag ? '4d' : '26'}` }} />
              <div style={{ position: 'absolute', left: 6, top: 3, font: `500 15px ${BODY}`, letterSpacing: '0.06em', color: P.mut }}>
                {String.fromCharCode(65 + r)}-{String(c + 1).padStart(2, '0')}
              </div>
            </div>
          );
        })}
        <div style={{
          position: 'absolute', left: mx - 20, top: my - 20, width: 40, height: 40,
          border: `2px solid ${P.accent}`, background: `${P.accent}59`,
          opacity: en(T, s + 0.9, 0.4), transform: `rotate(${move * 180}deg)`,
        }} />
      </div>
      <div style={{ position: 'absolute', right: 0, top: 0, width: 200 }}>
        {[['Ocupación', `${(62 + 9 * dr(T, s + 1.3, 1.7)).toFixed(0)}%`], ['Racks activos', '48'], ['Reacomodos hoy', `${move > 0.9 ? 13 : 12}`]].map((k, i) => (
          <div key={i} style={{ marginBottom: 18, opacity: en(T, s - 0.6 + i * 0.15, 0.6) }}>
            <div style={{ font: `500 15px ${BODY}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: P.mut }}>{k[0]}</div>
            <div style={{ font: `600 40px ${HEAD}`, color: P.ink, fontVariantNumeric: 'tabular-nums' }}>{k[1]}</div>
          </div>
        ))}
        <div style={{ opacity: po(T, s + 3.0, 0.6) }}>
          <Tag P={P} solid>C·03 → G·07</Tag>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, bottom: -2, opacity: po(T, s + 3.0, 0.6) }}>
        <Note P={P}>SKU de mayor rotación movido al pasillo de salida.</Note>
      </div>
    </React.Fragment>
  );
}

/* ── Panel: lotes ─────────────────────────────────────────────────── */
const LOTES = [
  ['LOTE-2481', 'CHR-FOO-08', '12/09/26', 16],
  ['LOTE-2477', 'VAS-PET-16', '04/11/26', 69],
  ['LOTE-2469', 'CTR-DOM-32', '22/12/26', 117],
  ['LOTE-2455', 'CHR-FOO-08', '03/02/27', 160],
];

function LotesBody({ T, P, B }) {
  const s = B.Lotes.s;
  const pulse = 0.5 + 0.5 * Math.sin(T * 4);
  return (
    <React.Fragment>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <Tag P={P}>Grado alimenticio</Tag><Tag P={P}>FEFO</Tag><Tag P={P} dim>NOM-051</Tag>
      </div>
      {LOTES.map((l, i) => {
        const a = en(T, s - 1.5 + i * 0.14, 0.6);
        const urgent = i === 0;
        const flag = urgent ? po(T, s + 1.6, 0.6) : 0;
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 14, height: 56,
            borderBottom: `1px solid ${P.line}`, opacity: 0.05 + 0.95 * a,
            transform: `translateY(${(1 - a) * 14}px)`,
            background: urgent && flag > 0.3 ? `${P.accent}1a` : 'transparent',
          }}>
            <div style={{ width: 160, font: `500 18px ${BODY}`, letterSpacing: '0.08em', color: P.deep }}>{l[0]}</div>
            <div style={{ width: 150, font: `400 18px ${BODY}`, letterSpacing: '0.06em', color: P.mut }}>{l[1]}</div>
            <div style={{ width: 120, font: `500 21px ${BODY}`, color: P.ink, fontVariantNumeric: 'tabular-nums' }}>{l[2]}</div>
            <div style={{ flex: 1, textAlign: 'right', font: `600 26px ${HEAD}`, color: urgent ? P.deep : P.ink, fontVariantNumeric: 'tabular-nums', opacity: urgent ? 0.6 + 0.4 * pulse : 1 }}>{l[3]} d</div>
          </div>
        );
      })}
      <div style={{ marginTop: 14, opacity: po(T, s + 2.4, 0.6) }}>
        <Note P={P}>LOTE-2481 con prioridad de salida (FEFO).</Note>
      </div>
    </React.Fragment>
  );
}

/* ── Panel: reportes ──────────────────────────────────────────────── */
const FAM = [['Bolsas', 0.78], ['Vasos', 0.94], ['Contenedores', 0.52], ['Cajas', 0.41], ['Playo', 0.33], ['Charolas', 0.61]];

function ReportesBody({ T, P, B }) {
  const s = B.Reportes.s;
  const H = 200;
  return (
    <React.Fragment>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 760, height: H + 46 }}>
        {[0, 0.25, 0.5, 0.75, 1].map((g, i) => (
          <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: H - g * H, height: 1, background: P.line }} />
        ))}
        <div style={{ position: 'absolute', left: 0, bottom: 46, right: 0, display: 'flex', alignItems: 'flex-end', gap: 26, height: H }}>
          {FAM.map((f, i) => {
            const h = f[1] * H * dr(T, s - 0.3 + i * 0.1, 1.1);
            return (
              <div key={i} style={{ flex: 1, position: 'relative' }}>
                <div style={{ height: Math.max(2, h), background: i === 1 ? P.accent : `${P.accent}5c`, border: `1px solid ${P.accent}` }} />
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, paddingTop: 8, font: `500 19px ${HEAD}`, color: P.mut, textAlign: 'center' }}>{f[0]}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ position: 'absolute', left: 810, top: 0, right: 0 }}>
        <div style={{ font: `500 15px ${BODY}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: P.mut }}>Pronóstico de demanda · 30 días</div>
        <div style={{ position: 'relative', height: 150, marginTop: 12, borderLeft: `1px solid ${P.line2}`, borderBottom: `1px solid ${P.line2}` }}>
          {Array.from({ length: 24 }).map((_, j) => {
            const p = j / 23;
            const y = 150 - (30 + 100 * (0.4 + 0.6 * p) * (0.85 + 0.15 * Math.sin(p * 7)));
            const show = clamp(dr(T, s + 0.9, 1.6) * 24 - j, 0, 1);
            return <div key={j} style={{ position: 'absolute', left: `${p * 100}%`, top: y, width: 7, height: 7, marginLeft: -3, marginTop: -3, background: j > 13 ? 'transparent' : P.accent, border: `1.5px solid ${P.accent}`, opacity: show }} />;
          })}
        </div>
        <div style={{ display: 'flex', gap: 40, marginTop: 14, opacity: po(T, s + 2.6, 0.6) }}>
          <div>
            <div style={{ font: `600 40px ${HEAD}`, color: P.ink }}>+22%</div>
            <div style={{ font: `400 18px ${BODY}`, color: P.mut }}>vasos, próxima quincena</div>
          </div>
          <div style={{ alignSelf: 'center' }}><Note P={P}>Ajuste aplicado</Note></div>
        </div>
      </div>
    </React.Fragment>
  );
}

/* ── Panel: facturación ───────────────────────────────────────────── */
function FactBody({ T, P, B }) {
  const s = B.AgenteChat.s;
  const q = dr(T, s + 2.0, 1.4);
  return (
    <React.Fragment>
      {[['1 – 999 pz', '$0.94'], ['1,000 – 9,999 pz', '$0.81'], ['10,000 + pz', '$0.68']].map((t, i) => {
        const act = i === 2 && q > 0.15;
        return (
          <div key={i} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 56,
            borderBottom: `1px solid ${P.line}`, padding: '0 10px', whiteSpace: 'nowrap',
            background: act ? `${P.accent}1a` : 'transparent',
            opacity: 0.1 + 0.9 * en(T, B.Reportes.s - 1.0 + i * 0.12, 0.6),
          }}>
            <div style={{ font: `500 22px ${HEAD}`, color: P.ink }}>{t[0]}</div>
            <div style={{ font: `500 24px ${BODY}`, color: act ? P.deep : P.ink, fontVariantNumeric: 'tabular-nums' }}>{t[1]}</div>
          </div>
        );
      })}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 18 }}>
        <div style={{ font: `500 15px ${BODY}`, letterSpacing: '0.1em', textTransform: 'uppercase', color: P.mut, whiteSpace: 'nowrap' }}>Cotización COT-1180</div>
        <div style={{ font: `600 44px ${HEAD}`, color: P.ink, fontVariantNumeric: 'tabular-nums' }}>${fmt(34000 * q)}</div>
      </div>
    </React.Fragment>
  );
}

/* ── Panel: usuarios ──────────────────────────────────────────────── */
const USERS = [
  ['A. Rueda', 'Administrador', 4], ['L. Fuentes', 'Almacén', 3],
  ['J. Ortega', 'Compras', 2], ['MARIO', 'Agente · full access', 4],
];

function UsersBody({ T, P, B }) {
  const s = B.AgenteChat.s;
  return USERS.map((u, i) => {
    const a = en(T, B.Reportes.s - 0.8 + i * 0.12, 0.6);
    const isAgent = i === 3;
    const glow = isAgent ? po(T, s + 1.2, 0.7) : 0;
    return (
      <div key={i} style={{
        display: 'flex', alignItems: 'center', gap: 14, height: 60, borderBottom: `1px solid ${P.line}`,
        opacity: 0.06 + 0.94 * a, background: glow > 0.3 ? `${P.accent}1a` : 'transparent',
      }}>
        <div style={{
          width: 38, height: 38, border: `1px solid ${isAgent ? P.accent : P.line2}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          font: `500 18px ${BODY}`, color: isAgent ? P.deep : P.mut,
          background: isAgent ? `${P.accent}26` : 'transparent',
        }}>{isAgent ? 'M' : u[0][0]}</div>
        <div style={{ flex: 1 }}>
          <div style={{ font: `500 22px ${HEAD}`, color: P.ink, letterSpacing: isAgent ? '0.06em' : 0 }}>{u[0]}</div>
          <div style={{ font: `400 17px ${BODY}`, color: P.mut }}>{u[1]}</div>
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          {[0, 1, 2, 3].map((d) => (
            <div key={d} style={{
              width: 13, height: 13, border: `1px solid ${P.accent}`,
              background: d < u[2] ? P.accent : 'transparent',
            }} />
          ))}
        </div>
      </div>
    );
  });
}

/* ── Panel: auditoría (crece durante todo el video) ───────────────── */
function AuditBody({ T, P, B }) {
  const LOG = [
    [B.Overview.s + 1.2, '08:02', 'MARIO', 'Conteo cíclico cerrado · 128 SKUs'],
    [B.Catalogo.s + 1.0, '08:09', 'MARIO', 'Catálogo sincronizado con proveedor'],
    [B.StockAlerta.s + 1.4, '08:33', 'SISTEMA', 'Salida 5,400 pz · pedido 7715'],
    [B.StockAlerta.s + 2.4, '08:34', 'MARIO', 'Alerta de mínimo · VAS-POL-12'],
    [B.OrdenCompra.s + 1.2, '08:41', 'MARIO', 'OC-2418 generada · $31,980.00'],
    [B.OrdenCompra.s + 3.0, '08:41', 'MARIO', 'OC-2418 enviada a proveedor'],
    [B.Movimientos.s + 2.7, '08:47', 'SCAN', 'Entrada 600 pz · CAJ-ALM-60'],
    [B.Racks.s + 2.6, '08:52', 'MARIO', 'Reacomodo C-03 → G-07'],
    [B.Lotes.s + 2.0, '09:04', 'MARIO', 'LOTE-2481 con prioridad FEFO'],
    [B.Reportes.s + 2.4, '09:12', 'MARIO', 'Pronóstico +22% · vasos'],
    [B.AgenteChat.s + 2.2, '09:20', 'A. RUEDA', 'Solicita cotización mayoreo'],
    [B.AgenteChat.s + 3.4, '09:20', 'MARIO', 'COT-1180 creada · $34,000.00'],
    [B.AgenteChat.s + 4.2, '09:21', 'MARIO', 'OC-2419 · 12,000 pz'],
  ];
  return LOG.map((l, i) => {
    const a = po(T, l[0], 0.5);
    if (a <= 0.001) return null;
    return (
      <div key={i} style={{
        paddingBottom: 8, marginBottom: 8, borderBottom: `1px solid ${P.line}`,
        opacity: a, transform: `translateX(${(1 - a) * -14}px)`,
      }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <div style={{ font: `400 16px ${BODY}`, color: P.mut, fontVariantNumeric: 'tabular-nums' }}>{l[1]}</div>
          <div style={{ font: `500 15px ${BODY}`, letterSpacing: '0.1em', color: l[2] === 'MARIO' ? P.deep : P.mut }}>{l[2]}</div>
        </div>
        <div style={{ font: `400 18px ${BODY}`, color: P.ink, textWrap: 'pretty', lineHeight: 1.25 }}>{l[3]}</div>
      </div>
    );
  });
}

/* ── Chrome: sidebar + topbar ─────────────────────────────────────── */
function Chrome({ T, P, B, active, brand, agent }) {
  const boot = dr(T, B.Apertura.s + 0.8, 1.2);
  const pulse = 0.5 + 0.5 * Math.sin(T * 2.6);
  return (
    <React.Fragment>
      <div style={{
        position: 'absolute', left: 0, top: 0, width: 240, height: BOARD_H, background: P.side,
        transform: `translateX(${(1 - boot) * -240}px)`,
      }}>
        <div style={{ height: 100, borderBottom: '1px solid rgba(233,237,242,0.16)', display: 'flex', alignItems: 'center', paddingLeft: 26, gap: 12 }}>
          <div style={{ width: 30, height: 30, border: `2px solid ${P.accent}` }} />
          <div style={{ font: `600 26px ${HEAD}`, letterSpacing: '0.12em', color: P.sideInk }}>{brand}</div>
        </div>
        {NAV.map((n, i) => {
          const on = n[1] === active;
          const a = en(T, B.Apertura.s + 1.0 + i * 0.05, 0.5);
          return (
            <div key={i} style={{
              height: 62, display: 'flex', alignItems: 'center', gap: 14, paddingLeft: 26,
              background: on ? P.accent : 'transparent', opacity: 0.1 + 0.9 * a,
            }}>
              <div style={{ width: 14, height: 14, border: `1.5px solid ${on ? '#fff' : 'rgba(233,237,242,0.6)'}`, background: on ? '#ffffff' : 'transparent' }} />
              <div style={{ font: `500 21px ${HEAD}`, color: on ? '#ffffff' : 'rgba(233,237,242,0.72)', letterSpacing: '0.02em' }}>{n[0]}</div>
            </div>
          );
        })}
      </div>

      <div style={{
        position: 'absolute', left: 240, top: 0, width: BOARD_W - 240, height: 100,
        borderBottom: `1px solid ${P.line2}`, display: 'flex', alignItems: 'center', gap: 26, padding: '0 32px',
        transform: `translateY(${(1 - boot) * -100}px)`,
      }}>
        <div style={{ font: `600 30px ${HEAD}`, color: P.ink, whiteSpace: 'nowrap' }}>Inventario · Almacén Central</div>
        <div style={{ flex: 1, maxWidth: 620, height: 46, border: `1px solid ${P.line}`, display: 'flex', alignItems: 'center', padding: '0 14px', font: `400 20px ${BODY}`, color: P.mut }}>
          Buscar SKU, lote, rack…
        </div>
        <div style={{ font: `400 20px ${BODY}`, color: P.mut }}>27 ago 2026 · 09:21</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${P.accent}`, padding: '7px 14px', background: `${P.accent}${pulse > 0.5 ? '1f' : '14'}` }}>
          <div style={{ width: 11, height: 11, borderRadius: 11, background: P.accent, opacity: 0.35 + 0.65 * pulse }} />
          <div style={{ font: `500 21px ${HEAD}`, letterSpacing: '0.08em', color: P.deep, textTransform: 'uppercase' }}>{agent} · agente activo</div>
        </div>
        <div style={{ width: 44, height: 44, border: `1px solid ${P.line2}`, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `500 20px ${BODY}`, color: P.mut }}>AR</div>
      </div>
    </React.Fragment>
  );
}

/* ── El retículo del agente ───────────────────────────────────────── */
function Reticle({ T, P, B, agent }) {
  const keys = ORDER.map((n, i) => ({
    t: B[n].s + (i === 0 ? 0 : 0.7),
    v: { x: RETICLE[n].x, y: RETICLE[n].y, o: RETICLE[n].on },
  }));
  keys.push({ t: B.Cierre.e, v: { x: RETICLE.Cierre.x, y: RETICLE.Cierre.y, o: 0 } });
  const r = kf(T, keys);
  const breathe = 1 + 0.06 * Math.sin(T * 3.2);
  const S = 108;
  return (
    <div style={{
      position: 'absolute', left: r.x - S / 2, top: r.y - S / 2, width: S, height: S,
      opacity: r.o, transform: `scale(${breathe})`, pointerEvents: 'none',
    }}>
      <Marks c={P.accent} />
      <div style={{ position: 'absolute', inset: 0, border: `1px solid ${P.accent}80` }} />
      <div style={{ position: 'absolute', left: '50%', top: -14, bottom: -14, width: 1, background: `${P.accent}59` }} />
      <div style={{ position: 'absolute', top: '50%', left: -14, right: -14, height: 1, background: `${P.accent}59` }} />
      <div style={{
        position: 'absolute', left: S + 14, top: '50%', marginTop: -16,
        background: P.accent, color: '#fff', padding: '3px 12px 1px',
        font: `600 22px ${HEAD}`, letterSpacing: '0.14em', textTransform: 'uppercase', whiteSpace: 'nowrap',
      }}>{agent}</div>
    </div>
  );
}

/* ── El cajón del agente (overlay en el viewport) ─────────────────── */
const CHAT = [
  ['user', 'Mario, cotiza 50 mil vasos PET 16 oz para Comercial Herrera.', 0.7],
  ['agent', 'Precio mayoreo $0.68 / pz · total $34,000.00 MXN.', 1.9],
  ['agent', 'Stock actual 48,600 pz. Generé OC-2419 por 12,000 pz con Polímeros del Bajío para cubrir el pedido.', 2.9],
];
const DONE = [
  ['Cotización COT-1180 creada', 3.6], ['OC-2419 enviada a proveedor', 4.0],
  ['Rack B-04 reservado para surtido', 4.4], ['Alerta de mínimo cerrada', 4.8],
];

function Drawer({ T, P, B, agent }) {
  const s = B.AgenteChat.s;
  const inA = en(T, s - 0.5, 0.75);
  const outA = 1 - en(T, B.Cierre.s - 0.5, 0.6);
  const a = inA * outA;
  if (a <= 0.002) return null;
  const W = 780;
  return (
    <div style={{
      position: 'absolute', right: 56, top: 64, bottom: 64, width: W,
      background: P.plate, border: `1px solid ${P.accent}`,
      transform: `translateX(${(1 - a) * (W + 90)}px)`, opacity: a,
      boxShadow: `0 24px 70px rgba(11,17,23,0.30)`, padding: '26px 30px',
    }}>
      <Marks c={P.mark} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 16, borderBottom: `1px solid ${P.line2}` }}>
        <div style={{ width: 34, height: 34, border: `2px solid ${P.accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `600 20px ${HEAD}`, color: P.deep }}>M</div>
        <div style={{ flex: 1 }}>
          <div style={{ font: `600 30px ${HEAD}`, letterSpacing: '0.06em', color: P.ink, textTransform: 'uppercase' }}>{agent}</div>
          <div style={{ font: `400 18px ${BODY}`, color: P.mut }}>Agente de inventario · acceso total</div>
        </div>
        <Tag P={P}>En línea</Tag>
      </div>
      {CHAT.map((m, i) => {
        const ma = en(T, s + m[2], 0.5);
        const mine = m[0] === 'user';
        return (
          <div key={i} style={{
            marginTop: 18, display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start',
            opacity: ma, transform: `translateY(${(1 - ma) * 16}px)`,
          }}>
            <div style={{
              maxWidth: '84%', padding: '12px 16px',
              border: `1px solid ${mine ? P.line2 : P.accent}`,
              background: mine ? 'transparent' : `${P.accent}14`,
              font: `400 22px ${BODY}`, color: P.ink, lineHeight: 1.4, textWrap: 'pretty',
            }}>{m[1]}</div>
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: 30, right: 30, bottom: 26 }}>
        <div style={{ font: `500 15px ${BODY}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: P.mut, marginBottom: 10 }}>Acciones ejecutadas</div>
        {DONE.map((d, i) => {
          const da = po(T, s + d[1], 0.45);
          if (da <= 0.001) return null;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, height: 44, borderTop: `1px solid ${P.line}`, opacity: da, transform: `translateX(${(1 - da) * 14}px)` }}>
              <div style={{ width: 20, height: 20, background: P.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', font: `500 15px ${BODY}` }}>✓</div>
              <div style={{ font: `400 21px ${BODY}`, color: P.ink }}>{d[0]}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Placa de marca (apertura y cierre — el mismo elemento) ───────── */
function Lockup({ T, P, B, brand, agent }) {
  const openOut = 1 - en(T, B.Apertura.s + 2.2, 0.8);
  const closeIn = en(T, B.Cierre.s + 1.0, 0.9);
  const a = Math.max(openOut, closeIn);
  if (a <= 0.002) return null;
  const rise = (1 - a) * 24;
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `${P.halo}f7`, opacity: a,
    }}>
      <div style={{
        border: `1px solid ${P.line2}`, background: P.plate, padding: '54px 88px',
        transform: `translateY(${rise}px)`, position: 'relative', textAlign: 'center',
      }}>
        <Marks c={P.mark} />
        <div style={{ font: `500 20px ${BODY}`, letterSpacing: '0.3em', textTransform: 'uppercase', color: P.mut }}>Panel de control · inventario</div>
        <div style={{ font: `600 116px ${HEAD}`, letterSpacing: '0.14em', color: P.ink, lineHeight: 1.05, marginTop: 10 }}>{brand}</div>
        <div style={{ height: 1, background: P.line2, margin: '22px auto', width: 420 }} />
        <div style={{ font: `500 34px ${HEAD}`, color: P.deep, letterSpacing: '0.02em' }}>
          Plásticos y cajas, administrados por {agent}
        </div>
      </div>
    </div>
  );
}

/* ── La pieza ─────────────────────────────────────────────────────── */
function Piece(props) {
  const c = useComposition();
  const T = c.T;
  const CUES = c.CUES;
  const P = PALETTES[props.theme] || PALETTES.papel;
  const brand = props.brand || 'NOVATEK';
  const agent = props.agent || 'MARIO';

  const B = {};
  ORDER.forEach((n, i) => {
    B[n] = { s: CUES[n], e: i + 1 < ORDER.length ? CUES[ORDER[i + 1]] : c.authoredTotal };
  });

  /* cámara */
  const camKeys = [];
  ORDER.forEach((n, i) => {
    const v = VIEWS[n];
    camKeys.push({ t: B[n].s + (i === 0 ? 0 : 0.7), v: { cx: v.cx, cy: v.cy, s: v.s } });
    const ve = VIEWS_END[n];
    camKeys.push({
      t: B[n].e,
      v: ve ? { cx: ve.cx, cy: ve.cy, s: ve.s } : { cx: v.cx + 22, cy: v.cy - 10, s: v.s * 1.035 },
    });
  });
  const cam = kf(T, camKeys);
  const bw = BOARD_W * cam.s, bh = BOARD_H * cam.s;
  let tx = 960 - cam.cx * cam.s;
  let ty = 540 - cam.cy * cam.s;
  tx = bw > 1920 ? clamp(tx, 1920 - bw, 0) : (1920 - bw) / 2;
  ty = bh > 1080 ? clamp(ty, 1080 - bh, 0) : (1080 - bh) / 2;

  /* escena activa */
  let active = 'Overview';
  for (let i = 0; i < ORDER.length; i++) if (T >= B[ORDER[i]].s) active = ORDER[i];
  const nav = active === 'Apertura' ? 'Overview' : active;
  const gl = (n) => clamp(Math.min((T - (B[n].s - 0.5)) / 0.6, (B[n].e + 0.4 - T) / 0.6), 0, 1);

  return (
    <div data-screen-label={`t=${T.toFixed(0)}s`} style={{
      position: 'absolute', inset: 0, overflow: 'hidden', background: P.bg,
      fontFamily: BODY, color: P.ink,
    }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, width: BOARD_W, height: BOARD_H,
        transformOrigin: '0 0', transform: `translate(${tx}px, ${ty}px) scale(${cam.s})`,
        backgroundImage: `linear-gradient(${P.grid} 1px, transparent 1px), linear-gradient(90deg, ${P.grid} 1px, transparent 1px)`,
        backgroundSize: '48px 48px',
      }}>
        <Chrome T={T} P={P} B={B} active={nav} brand={brand} agent={agent} />
        <KpiRow T={T} P={P} B={B} glow={gl('Overview')} />

        <Panel x={280} y={500} w={1140} h={500} kicker="Catálogo" title="Productos por familia" P={P}
          glow={gl('Catalogo')} appear={en(T, B.Apertura.s + 1.6, 0.7)}
          right={<Tag P={P} dim>1,284 SKUs</Tag>}>
          <CatalogoBody T={T} P={P} B={B} />
        </Panel>

        <Panel x={1450} y={500} w={1110} h={500} kicker="Stock por SKU" title="Niveles y mínimos" P={P}
          glow={gl('StockAlerta')} appear={en(T, B.Apertura.s + 1.75, 0.7)}
          right={<Tag P={P}>Tiempo real</Tag>}>
          <StockBody T={T} P={P} B={B} />
        </Panel>

        <Panel x={2590} y={500} w={970} h={500} kicker="Órdenes de compra" title="Reabastecimiento" P={P}
          glow={gl('OrdenCompra')} appear={en(T, B.Apertura.s + 1.9, 0.7)}>
          <OcBody T={T} P={P} B={B} />
        </Panel>

        <Panel x={280} y={1030} w={900} h={470} kicker="Movimientos" title="Entradas y salidas" P={P}
          glow={gl('Movimientos')} appear={en(T, B.Apertura.s + 2.05, 0.7)}>
          <MovBody T={T} P={P} B={B} />
        </Panel>

        <Panel x={1210} y={1030} w={1050} h={470} kicker="Ubicaciones" title="Mapa de racks" P={P}
          glow={gl('Racks')} appear={en(T, B.Apertura.s + 2.2, 0.7)}>
          <RacksBody T={T} P={P} B={B} />
        </Panel>

        <Panel x={2290} y={1030} w={770} h={470} kicker="Lotes" title="Caducidad y trazabilidad" P={P}
          glow={gl('Lotes')} appear={en(T, B.Apertura.s + 2.35, 0.7)}>
          <LotesBody T={T} P={P} B={B} />
        </Panel>

        <Panel x={3090} y={1030} w={470} h={890} kicker="Auditoría" title="Historial" P={P}
          glow={gl('Cierre')} appear={en(T, B.Apertura.s + 2.5, 0.7)}>
          <AuditBody T={T} P={P} B={B} />
        </Panel>

        <Panel x={280} y={1530} w={1280} h={390} kicker="Reportes" title="Rotación y pronóstico" P={P}
          glow={gl('Reportes')} appear={en(T, B.Apertura.s + 2.65, 0.7)}>
          <ReportesBody T={T} P={P} B={B} />
        </Panel>

        <Panel x={1590} y={1530} w={790} h={390} kicker="Facturación" title="Precios de mayoreo" P={P}
          glow={gl('AgenteChat')} appear={en(T, B.Apertura.s + 2.8, 0.7)}>
          <FactBody T={T} P={P} B={B} />
        </Panel>

        <Panel x={2410} y={1530} w={650} h={390} kicker="Usuarios" title="Roles y permisos" P={P}
          glow={gl('AgenteChat')} appear={en(T, B.Apertura.s + 2.95, 0.7)}>
          <UsersBody T={T} P={P} B={B} />
        </Panel>

        <Reticle T={T} P={P} B={B} agent={agent} />
      </div>

      <Drawer T={T} P={P} B={B} agent={agent} />
      <Lockup T={T} P={P} B={B} brand={brand} agent={agent} />

      {props.captions !== false && (
        <Captions
          items={[
            { at: B.Apertura.s + 2.6, until: B.Overview.s + 0.3, text: 'Un almacén de plásticos y cajas, en un solo tablero.' },
            { at: B.Overview.s + 0.6, text: '1,284 SKUs vivos: stock, valor y rotación al minuto.' },
            { at: B.Catalogo.s + 0.5, text: 'Catálogo completo por familia: bolsas, vasos, contenedores, cajas.' },
            { at: B.StockAlerta.s + 0.6, text: 'Una salida fuerte hunde el nivel. Mario lo detecta al instante.' },
            { at: B.OrdenCompra.s + 0.4, text: 'La orden de compra se genera y se envía sola.' },
            { at: B.Movimientos.s + 0.5, text: 'Cada entrada y salida entra por escaneo, no por captura.' },
            { at: B.Racks.s + 0.5, text: 'Y el acomodo del almacén se optimiza según la demanda.' },
            { at: B.Lotes.s + 0.5, text: 'Lotes de grado alimenticio con caducidad bajo control FEFO.' },
            { at: B.Reportes.s + 0.5, text: 'Rotación real y pronóstico a 30 días.' },
            { at: B.AgenteChat.s + 0.6, text: 'Le pides algo en lenguaje normal. Él lo ejecuta en el panel.' },
            { at: B.Cierre.s + 0.3, until: B.Cierre.s + 1.4, text: 'Todo queda registrado en la auditoría.' },
          ]}
          style={{
            left: '13%', right: `${13 + 33 * (en(T, B.AgenteChat.s - 0.5, 0.75) - en(T, B.Cierre.s - 0.5, 0.6))}%`,
            bottom: '4.5%', textAlign: 'center',
            background: P.plate, border: `1px solid ${P.accent}`, padding: '12px 26px 10px',
            boxShadow: P.noteShadow, textShadow: 'none',
            font: `600 38px ${HEAD}`, color: P.ink, letterSpacing: '0.01em', lineHeight: 1.18,
          }}
        />
      )}
    </div>
  );
}

/* ── Raíz: stage + tweaks ─────────────────────────────────────────── */
function NovatekVideo() {
  const tw = window.useTweaks(window.TWEAK_DEFAULTS || {});
  const t = tw[0], setTweak = tw[1];
  const { TweaksPanel, TweakSection, TweakToggle, TweakRadio, TweakText, CompositionStage } = window;
  return (
    <React.Fragment>
      <CompositionStage
        width={1920} height={1080}
        scenes={window.OM_SCENES} playback={window.OM_PLAYBACK}
        bg={(PALETTES[t.theme] || PALETTES.papel).bg}
      >
        <Piece theme={t.theme} captions={t.captions} brand={t.brand} agent={t.agent} />
      </CompositionStage>
      <TweaksPanel>
        <TweakSection label="Marca" />
        <TweakText label="Empresa" value={t.brand} onChange={(v) => setTweak('brand', v)} />
        <TweakText label="Agente" value={t.agent} onChange={(v) => setTweak('agent', v)} />
        <TweakSection label="Presentación" />
        <TweakRadio label="Tema" value={t.theme} options={['papel', 'acero']} onChange={(v) => setTweak('theme', v)} />
        <TweakToggle label="Subtítulos" value={t.captions} onChange={(v) => setTweak('captions', v)} />
        <TweakToggle label="Motion editor" value={t.motionEditor} onChange={(v) => setTweak('motionEditor', v)} />
      </TweaksPanel>
    </React.Fragment>
  );
}

window.NovatekVideo = NovatekVideo;
