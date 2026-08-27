# -*- coding: utf-8 -*-
"""De un prospecto a un sitio, sobre la insignia.

   La idea que hace que esto funcione: el sistema de diseño de nerv ES *"la
   lectura de un instrumento impresa en papel"* (`lab/insignia/opendesign/
   DESIGN.md`), y lo que tenemos del prospecto ES su registro oficial en el
   DENUE. La forma y el contenido son la misma cosa. Por eso el corazón de la
   página no es un texto de agencia: es su propia ficha, compuesta.

   ── Las tres reglas que no se rompen ────────────────────────────────────────

   1. NO SE INVENTA NADA SOBRE EL NEGOCIO. Todo dato duro sale del DENUE. Lo
      demás está escrito en primera persona de nerv y se lee como propuesta, no
      como si el negocio lo hubiera dicho. Poner palabras en la boca de una
      empresa real, con su nombre encima, es la forma más rápida de perder al
      cliente y de merecerlo.

   2. NO SE HACE PASAR POR SU SITIO OFICIAL. Barra visible arriba, `noindex` en
      el encabezado, y la firma de nerv en el pie. Sin eso esto es una
      suplantación con buen diseño.

   3. EL ACENTO NO SE INVENTA. Los tres que sanciona el sistema —azul, rojo,
      ácido—, uno por pieza y nunca juntos, y sólo en tamaños grandes o marcas.
      El texto de leer siempre va tinta sobre papel. Derivar un color por
      negocio se sentiría a la medida y tiraría el contraste medido.

   Uso:
       python generador/sitio.py --prospectos datos/prospectos.json --n 10
"""

import argparse
import io
import json
import os
import re

# ── LA PALETA ───────────────────────────────────────────────────────────────
# El acento cambia con el suelo, y esto NO es cosmético: `tokens.css` ya lo
# decía —sobre suelo negro el azul es `#6e69ff`— y usar el `#0102ec` de papel
# sobre negro da **2.09:1**, que es texto invisible. Medido, no supuesto.
#
# El segundo valor es el color del texto ENCIMA del acento (el botón). Va a
# mano y no por fórmula: sobre ácido el blanco desaparece y sobre rojo se queda
# en 4.00:1, justo debajo del mínimo. Ése es el error que un generador comete
# solo, y por eso abajo hay un candado que lo mide antes de escribir el archivo.
ACENTOS = {
    'azul':  {'papel': ('#0102ec', '#ffffff'), 'negro': ('#6e69ff', '#0a0a0a'),
              'nombre': 'ELECTRIC BLUE'},
    'rojo':  {'papel': ('#ff0000', '#0a0a0a'), 'negro': ('#ff0000', '#0a0a0a'),
              'nombre': 'RED'},
    'acido': {'papel': ('#ccff33', '#0a0a0a'), 'negro': ('#ccff33', '#0a0a0a'),
              'nombre': 'ACID'},
}


def luminancia(hexa):
    h = hexa.lstrip('#')
    canales = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    lineal = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
              for c in canales]
    return 0.2126 * lineal[0] + 0.7152 * lineal[1] + 0.0722 * lineal[2]


def contraste(a, b):
    la, lb = luminancia(a), luminancia(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def revisar_paleta(suelo, acento_hex, acento_sobre):
    """El candado. Devuelve la lista de pares que no llegan al mínimo.

       Existe porque la combinación suelo+acento se decide en una tabla por
       sector (`prospectos.py`), y una tabla se edita sin ver el resultado: el
       día que alguien mande ácido sobre papel, esto lo detiene antes de
       escribir 6,777 archivos ilegibles en vez de después.

       El acento NUNCA sostiene texto de leer —para eso está la tinta— así que
       aquí se le exige 3.0 de elemento grande y no 4.5."""
    pares = [
        ('texto/suelo', suelo['fg'], suelo['bg'], 4.5),
        ('secundario/suelo', suelo['muted'], suelo['bg'], 4.5),
        ('display acento/suelo', acento_hex, suelo['bg'], 3.0),
        ('invertido suelo/tinta', suelo['bg'], suelo['fg'], 4.5),
        ('texto del boton', acento_sobre, acento_hex, 4.5),
    ]
    return [(n, round(contraste(x, y), 2), m)
            for n, x, y, m in pares if contraste(x, y) < m]

SUELOS = {
    'papel': {
        'bg': '#f4f7fc', 'surface': '#ffffff', 'fg': '#08123a', 'fg2': '#16224d',
        'muted': '#5d6e93', 'meta': '#9db8dc', 'border': '#000000',
        'suave': 'rgba(8,18,58,0.22)', 'nombre': 'PAPER',
    },
    'negro': {
        'bg': '#0a0a0a', 'surface': '#0a0a0a', 'fg': '#ffffff', 'fg2': '#e6effb',
        'muted': '#7d8ba3', 'meta': '#6699ff', 'border': '#ffffff',
        'suave': 'rgba(255,255,255,0.24)', 'nombre': 'TOTAL BLACK',
    },
}

# ── LO QUE SE PROPONE, POR SECTOR ───────────────────────────────────────────
# Escrito como propuesta de nerv. Ninguna frase afirma algo sobre el negocio
# que no venga del DENUE.
PROPUESTA = {
    '31': ('PLANTA', [
        ('Catálogo de capacidades', 'Qué procesos corren, con qué tolerancias y en qué volúmenes. Un comprador industrial busca eso y nada más.'),
        ('Certificaciones a la vista', 'Las normas que ya cumplen, arriba y legibles. Es lo primero que filtra una compra grande.'),
        ('Cotización que llega', 'Un formulario que aterriza en su correo con el plano adjunto, no un buzón que nadie abre.'),
    ]),
    '23': ('OBRA', [
        ('Obra terminada, con números', 'Metros, plazo y ubicación de cada proyecto. Las fotos convencen; los datos cierran.'),
        ('Licencias y responsiva', 'Registro, seguros y DRO al frente. Quien contrata construcción revisa eso antes que el portafolio.'),
        ('Levantamiento en línea', 'El interesado describe su obra y llega clasificada, no como un "quiero cotizar".'),
    ]),
    '54': ('DESPACHO', [
        ('Servicios sin ambigüedad', 'Qué resuelven y para quién, en una frase por servicio. La consultoría se pierde por vaga.'),
        ('Quién firma', 'Los perfiles de quienes atienden. En servicios profesionales se contrata a la persona, no a la marca.'),
        ('Agenda conectada', 'Una llamada apartada en su calendario real, sin el ida y vuelta de correos.'),
    ]),
    '43': ('MAYOREO', [
        ('Catálogo consultable', 'Existencias y claves buscables. Un comprador que no encuentra la clave se va con quien sí la muestra.'),
        ('Lista por cliente', 'Precios distintos por volumen sin publicar la tabla entera.'),
        ('Pedido directo', 'Del catálogo al pedido sin salir del sitio ni marcar por teléfono.'),
    ]),
    '46': ('MOSTRADOR', [
        ('Lo que hay hoy', 'Existencias reales. La consulta más común es "¿lo tienes?" y hoy se contesta por teléfono, una por una.'),
        ('Cómo llegar', 'Mapa, horario y estacionamiento. La mitad de las visitas se pierden aquí.'),
        ('Venta en línea', 'Si la pieza se puede enviar, que se venda sin que nadie conteste el teléfono.'),
    ]),
    '48': ('FLOTA', [
        ('Cobertura y equipo', 'Rutas, unidades y capacidades. Un embarcador compara eso en dos minutos.'),
        ('Rastreo del embarque', 'Dónde va la carga, sin llamar a operaciones.'),
        ('Cotización por ruta', 'Origen, destino y peso; el interesado llega con el dato completo.'),
    ]),
    '56': ('SERVICIO', [
        ('Alcance del servicio', 'Qué incluye y qué no. Los reclamos de este giro nacen todos ahí.'),
        ('Cobertura y tiempos', 'Zonas atendidas y tiempo de respuesta comprometido.'),
        ('Alta de cliente', 'Del interesado al contrato sin papeleo de ida y vuelta.'),
    ]),
    '53': ('CARTERA', [
        ('Propiedades con ficha', 'Metros, uso de suelo y ubicación de cada una, consultable.'),
        ('Recorrido sin cita', 'La propiedad vista de noche y en domingo, cuando el interesado busca de verdad.'),
        ('Interesados calificados', 'Presupuesto y uso antes de que alguien salga a enseñar.'),
    ]),
    '62': ('CLÍNICA', [
        ('Servicios y quién los da', 'Cédulas y especialidades al frente. Es lo que decide una primera cita.'),
        ('Cita en línea', 'Horarios reales, sin llamar en horario de oficina.'),
        ('Indicaciones previas', 'Lo que el paciente debe saber antes de llegar, escrito una vez.'),
    ]),
    '81': ('TALLER', [
        ('Servicios y tiempos', 'Qué hacen y en cuánto. La pregunta de siempre, contestada antes de que la hagan.'),
        ('Cita y seguimiento', 'Apartar entrada y avisar cuando esté listo, sin llamadas.'),
        ('Trabajos anteriores', 'Antes y después. En este giro es lo único que convence.'),
    ]),
}

# La manufactura es el mejor segmento y entra por tres sectores, no por uno:
# 31 alimentos y textiles, 32 quimica y plasticos, 33 metal y maquinaria. Con
# solo el 31 declarado, una fabrica de maquinaria caia al texto generico —
# medido en el primer lote: el rotulo decia NEGOCIO en una planta.
PROPUESTA['32'] = PROPUESTA['31']
PROPUESTA['33'] = PROPUESTA['31']
PROPUESTA['49'] = PROPUESTA['48']
PROPUESTA['51'] = PROPUESTA['54']

PROPUESTA_DEFECTO = ('NEGOCIO', [
    ('Qué hacen, en claro', 'Una página que contesta lo que preguntan por teléfono todo el día.'),
    ('Cómo los encuentran', 'Ubicación, horario y contacto donde se buscan: en el celular y en un mapa.'),
    ('Un agente que atiende', 'El mismo chat que estás por usar aquí abajo, con los datos del negocio.'),
])

CONTACTO_NERV = {
    'sitio': 'https://nervcenter.online',
    'correo': 'dani@nervcenter.online',
}


def esc(texto):
    return (str(texto or '')
            .replace('&', '&amp;').replace('<', '&lt;')
            .replace('>', '&gt;').replace('"', '&quot;'))


def semilla(texto):
    """Un entero estable a partir de una cadena. Sin `random`: dos corridas
       sobre el mismo prospecto tienen que dar el mismo sitio, o cada
       regeneración cambiaría la página que ya le mandamos por correo."""
    h = 2166136261
    for c in str(texto):
        h = ((h ^ ord(c)) * 16777619) & 0xFFFFFFFF
    return h


def serie(valor, cuantos, tope):
    """Números pseudoaleatorios deterministas. Congruencial lineal, que para
       texturas alcanza y cabe en cinco líneas."""
    x = semilla(valor) or 1
    salida = []
    for _ in range(cuantos):
        x = (1103515245 * x + 12345) & 0x7FFFFFFF
        salida.append(x % tope)
    return salida


def telemetria(clave, cuantos=38):
    """Las coordenadas de textura. La regla del sistema: los números tienen que
       CORRESPONDER a dónde están —x crece a la derecha, y hacia abajo—. Un
       número al azar se nota; uno que corresponde, no.

       Va con aria-hidden: un lector de pantalla recitando cuarenta pares de
       coordenadas falsas es una tortura, no una textura."""
    xs = serie(clave + 'x', cuantos, 1000)
    ys = serie(clave + 'y', cuantos, 1000)
    corchete = serie(clave + 'c', cuantos, 2)
    piezas = []
    for i in range(cuantos):
        izq, arr = xs[i] / 10.0, ys[i] / 10.0
        x, y = int(izq * 19.2), int(arr * 24)
        texto = 'x:%d y:%d' % (x, y)
        if corchete[i]:
            texto = '[ %s ]' % texto
        piezas.append(
            '<i style="left:%.1f%%;top:%.1f%%">%s</i>' % (izq, arr, texto)
        )
    return '<div class="tele" aria-hidden="true">%s</div>' % ''.join(piezas)


def barras(clave, cuantas=52):
    """Código de barras derivado de una cadena: dos códigos distintos se ven
       distintos. No codifica nada y no pretende hacerlo — es una marca de
       procedencia, no un producto de tienda."""
    anchos = serie(clave + 'b', cuantas, 4)
    return ''.join(
        '<b style="width:%dpx"></b>' % (1 + a) for a in anchos
    )


def telefono_bonito(t):
    if len(t) == 10:
        return '%s %s %s' % (t[:2], t[2:6], t[6:])
    return t


def dato(etiqueta, valor, resalte=False):
    """Una fila de la ficha.

       El resalte va en la MISMA lista de clases. Estuvo un rato como un
       segundo atributo `class` —`<div class="fila" class="alto">`— que el
       navegador descarta en silencio: el HTML seguia siendo valido a la vista,
       y la unica linea que hace el argumento de venta se pintaba como las
       demas. Un error que no rompe nada es el que sobrevive al repaso."""
    if not valor:
        return ''
    clases = 'fila alto' if resalte else 'fila'
    return (
        '<div class="%s"><span class="k">%s</span>'
        '<span class="p" aria-hidden="true"></span>'
        '<span class="v">%s</span></div>'
    ) % (clases, esc(etiqueta), esc(valor))


def construir(p):
    nombre_suelo = p.get('ground') if p.get('ground') in SUELOS else 'papel'
    suelo = SUELOS[nombre_suelo]
    acento = ACENTOS.get(p.get('acento'), ACENTOS['azul'])
    acento_hex, acento_sobre = acento[nombre_suelo]

    malos = revisar_paleta(suelo, acento_hex, acento_sobre)
    if malos:
        detalle = '; '.join('%s %.2f < %.1f' % (n, r, m) for n, r, m in malos)
        raise SystemExit(
            'paleta ilegible para %s (%s + %s): %s'
            % (p.get('nombre'), nombre_suelo, p.get('acento'), detalle))
    rotulo, bloques = PROPUESTA.get(p.get('sector'), PROPUESTA_DEFECTO)

    nombre = p['nombre']
    clave = p.get('id') or nombre

    direccion = ', '.join(x for x in [p.get('calle'), p.get('colonia')] if x)
    ciudad = ', '.join(x for x in [p.get('municipio'), p.get('cp')] if x)

    ficha = ''.join([
        dato('giro', p.get('giro')),
        dato('scian', p.get('codigo_act')),
        dato('personal', p.get('personal')),
        dato('domicilio', direccion),
        dato('municipio', ciudad),
        dato('teléfono', telefono_bonito(p.get('telefono', ''))),
        dato('correo', p.get('correo')),
        dato('coordenadas', '%s, %s' % (p.get('lat', ''), p.get('lon', ''))
             if p.get('lat') else ''),
        dato('alta en el denue', p.get('alta')),
        dato('sitio web', 'SIN REGISTRO', resalte=True),
    ])

    tarjetas = ''.join(
        '<article class="p-b"><h3>%s</h3><p>%s</p>'
        '<span class="n" aria-hidden="true">%02d</span></article>'
        % (esc(t), esc(d), i + 1)
        for i, (t, d) in enumerate(bloques)
    )

    asunto = 'Sobre la propuesta para %s' % nombre
    liga_correo = 'mailto:%s?subject=%s' % (
        CONTACTO_NERV['correo'], esc(asunto).replace(' ', '%20'))

    return PLANTILLA.format(
        apodo=esc(p['apodo']),
        nombre=esc(nombre),
        nombre_titulo=esc(nombre[:60]),
        giro=esc(p.get('giro', '')),
        municipio=esc(p.get('municipio', '')),
        rotulo=esc(rotulo),
        ficha=ficha,
        tarjetas=tarjetas,
        telemetria=telemetria(clave),
        barras=barras(clave),
        liga_correo=liga_correo,
        correo_nerv=CONTACTO_NERV['correo'],
        sitio_nerv=CONTACTO_NERV['sitio'],
        folio=esc(p.get('id', '')),
        bg=suelo['bg'], surface=suelo['surface'], fg=suelo['fg'], fg2=suelo['fg2'],
        muted=suelo['muted'], meta=suelo['meta'], border=suelo['border'],
        suave=suelo['suave'], suelo_nombre=suelo['nombre'],
        acento=acento_hex, acento_sobre=acento_sobre,
        acento_nombre=acento['nombre'],
    )


PLANTILLA = u"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- Esto es una propuesta, no el sitio de nadie. Que no se indexe NO es un
     detalle: sin esto, con el tiempo, un buscador lo pondria por encima de su
     negocio real y le hariamos un dano en vez de un favor. -->
<meta name="robots" content="noindex, nofollow">
<title>{nombre_titulo} — propuesta de nerv</title>
<meta name="description" content="Propuesta de sitio web hecha por nerv para {nombre_titulo}. No es el sitio oficial del negocio.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {{
  --bg:{bg}; --surface:{surface}; --fg:{fg}; --fg-2:{fg2};
  --muted:{muted}; --meta:{meta}; --border:{border}; --suave:{suave};
  --accent:{acento}; --accent-on:{acento_sobre};
  --display:"Space Grotesk","Helvetica Neue",Arial,sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,Menlo,monospace;
}}
*,*::before,*::after {{ box-sizing:border-box; }}
html {{ -webkit-text-size-adjust:100%; }}
body {{
  margin:0; background:var(--bg); color:var(--fg);
  font-family:var(--display); font-size:15px; line-height:1.7;
  -webkit-font-smoothing:antialiased;
}}
/* Radio cero en todo. Una sola esquina de 8px mata la gramatica. */
a {{ color:inherit; }}
.env {{ max-width:1420px; margin:0 auto; padding:0 46px; position:relative; }}
@media (max-width:900px) {{ .env {{ padding:0 28px; }} }}
@media (max-width:560px) {{ .env {{ padding:0 14px; }} }}

/* La barra negra sangra: una barra que respeta el margen no hace nada. */
.aviso {{
  background:var(--fg); color:var(--bg);
  font-family:var(--mono); font-size:9px; letter-spacing:3px;
  text-transform:uppercase; padding:9px 0;
}}
.aviso .env {{ display:flex; gap:14px; justify-content:space-between; flex-wrap:wrap; }}

.tele {{ position:absolute; inset:0; pointer-events:none; overflow:hidden; z-index:0; }}
.tele i {{
  position:absolute; font-family:var(--mono); font-size:6px;
  font-style:normal; color:var(--muted); opacity:.62; white-space:nowrap;
}}

header {{ position:relative; padding:78px 0 40px; overflow:hidden; }}
.et {{
  font-family:var(--mono); font-size:9px; letter-spacing:3px;
  text-transform:uppercase; color:var(--muted);
}}
.titulo {{ position:relative; z-index:1; margin:22px 0 0; }}
/* El display nunca va solo: lleva subrayado de 2px y dos micro-etiquetas. */
.titulo h1 {{
  font-size:clamp(38px,7vw,92px); font-weight:700; letter-spacing:-.035em;
  line-height:.92; margin:0; padding-bottom:14px;
  border-bottom:2px solid var(--accent); display:inline-block; max-width:100%;
  overflow-wrap:anywhere;
}}
.flanco {{ display:flex; gap:18px; margin-top:10px; flex-wrap:wrap; }}
.flanco span {{
  font-family:var(--mono); font-size:9px; letter-spacing:3px;
  text-transform:uppercase; color:var(--muted);
}}
.sub {{ margin:26px 0 0; max-width:62ch; color:var(--fg-2); font-size:17px; }}

section {{ padding:78px 0; position:relative; }}
@media (max-width:900px) {{ section, header {{ padding:56px 0; }} }}
@media (max-width:560px) {{ section, header {{ padding:40px 0; }} }}

/* Las reglas no cierran: corren, giran 90 grados, hacen una pata y paran. */
.marco {{ border-top:1px solid var(--border); border-right:1px solid var(--border);
  padding:26px 26px 0 0; position:relative; }}
.marco::after {{ content:""; position:absolute; right:-1px; bottom:0;
  width:1px; height:28px; background:var(--border); }}

.rej {{ display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.15fr); gap:56px; }}
@media (max-width:900px) {{ .rej {{ grid-template-columns:1fr; gap:34px; }} }}

h2 {{ font-size:clamp(24px,3vw,38px); font-weight:700; letter-spacing:-.035em;
  line-height:1.05; margin:12px 0 0; }}

.ficha {{ font-family:var(--mono); font-size:13px; }}
.fila {{ display:flex; align-items:baseline; gap:10px; padding:9px 0;
  border-bottom:1px solid var(--suave); }}
.fila .k {{ font-size:9px; letter-spacing:3px; text-transform:uppercase;
  color:var(--muted); flex:0 0 auto; min-width:118px; }}
.fila .p {{ flex:1 1 auto; border-bottom:1px dotted var(--suave);
  transform:translateY(-3px); }}
.fila .v {{ flex:0 1 auto; text-align:right; overflow-wrap:anywhere; }}
.fila.alto .v {{ font-weight:500; }}
/* El valor va en TINTA, no en el acento: a 13px el acento no sostiene texto
   —rojo sobre papel da 3.72:1— y la regla del sistema es una sola, "un acento
   y todo lo demas tinta sobre papel". El acento marca la fila con la regla y
   el punto, que es su trabajo: senalar, no leerse. */
.fila.alto {{ border-bottom:1px solid var(--accent); }}
.fila.alto .k::before {{
  content:""; display:inline-block; width:5px; height:5px;
  background:var(--accent); margin-right:7px; vertical-align:middle;
}}

.p-b {{ position:relative; padding:22px 0 22px 0; border-top:1px solid var(--border); }}
.p-b h3 {{ margin:0 0 6px; font-size:17px; font-weight:700; letter-spacing:-.02em; }}
.p-b p {{ margin:0; color:var(--muted); max-width:52ch; }}
.p-b .n {{ position:absolute; top:22px; right:0; font-family:var(--mono);
  font-size:9px; letter-spacing:3px; color:var(--accent); }}

.cta {{ background:var(--fg); color:var(--bg); }}
.cta h2 {{ color:var(--bg); }}
.cta p {{ color:var(--bg); opacity:.82; max-width:56ch; }}
.boton {{
  display:inline-block; margin-top:26px; background:var(--accent);
  color:var(--accent-on); text-decoration:none; font-family:var(--mono);
  font-size:13px; letter-spacing:2px; text-transform:uppercase;
  padding:15px 30px; border:0; font-weight:500;
  transition:transform 120ms cubic-bezier(.16,.84,.3,1);
}}
.boton:hover {{ transform:translate(2px,-2px); }}
.boton:focus-visible {{ outline:none; box-shadow:0 0 0 2px var(--fg),0 0 0 4px var(--accent); }}

/* El codigo de barras: deriva de una cadena, no codifica nada, y no pretende. */
.barras {{ display:flex; align-items:flex-end; gap:2px; height:38px; margin-top:8px; }}
.barras b {{ display:block; height:100%; background:var(--fg); opacity:.85; }}

footer {{ border-top:1px solid var(--border); padding:34px 0 56px;
  font-family:var(--mono); font-size:9px; letter-spacing:3px;
  text-transform:uppercase; color:var(--muted); }}
.legend {{ display:flex; gap:16px; flex-wrap:wrap; margin-top:16px; font-size:6px;
  letter-spacing:2px; }}
.pie-r {{ display:flex; justify-content:space-between; gap:20px; flex-wrap:wrap; }}
footer a {{ color:var(--accent); }}

@media (prefers-reduced-motion:reduce) {{
  * {{ transition:none !important; }}
}}
</style>
</head>
<body>

<div class="aviso">
  <div class="env">
    <span>Propuesta de nerv — no es el sitio oficial de este negocio</span>
    <span>Folio DENUE {folio}</span>
  </div>
</div>

<header>
  {telemetria}
  <div class="env">
    <p class="et">{rotulo} · {municipio}</p>
    <div class="titulo">
      <h1>{nombre}</h1>
      <div class="flanco">
        <span>Sitio propuesto</span>
        <span>nerv · {sitio_nerv}</span>
      </div>
    </div>
    <p class="sub">Esto es lo que se vería si {nombre} tuviera sitio. Lo armamos
    con su registro público, sin pedirles nada. Si les sirve, se lo dejamos
    funcionando con su contenido real.</p>
  </div>
</header>

<section>
  <div class="env">
    <div class="rej">
      <div class="marco">
        <p class="et">Registro público</p>
        <h2>Lo que ya se sabe de ustedes</h2>
        <p style="color:var(--muted);max-width:46ch">Todo lo de la derecha sale
        del Directorio Estadístico Nacional de Unidades Económicas del INEGI. No
        preguntamos nada ni inventamos nada — está publicado.</p>
        <div class="barras" aria-hidden="true">{barras}</div>
      </div>
      <div class="ficha">{ficha}</div>
    </div>
  </div>
</section>

<section>
  <div class="env">
    <p class="et">Propuesta</p>
    <h2>Lo que llevaría el sitio</h2>
    <div style="margin-top:34px">{tarjetas}</div>
  </div>
</section>

<section class="cta">
  <div class="env">
    <p class="et" style="color:var(--bg);opacity:.7">Siguiente paso</p>
    <h2>Si les late, se los dejamos funcionando</h2>
    <p>Esta página ya existe. Ponerle su contenido real, su dominio y un agente
    que conteste a quien llegue es cuestión de días, no de meses. Y si no les
    interesa, se borra y no vuelven a saber de nosotros.</p>
    <a class="boton" href="{liga_correo}">Escribir a nerv</a>
  </div>
</section>

<footer>
  <div class="env">
    <div class="pie-r">
      <span>nerv · <a href="{sitio_nerv}">{sitio_nerv}</a> · {correo_nerv}</span>
      <span>Propuesta no solicitada · sin indexar</span>
    </div>
    <div class="legend" aria-hidden="true">
      <span>{suelo_nombre} {bg}</span><span>ACCENT {acento_nombre} {acento}</span>
      <span>INK {fg}</span><span>RULE {border}</span>
    </div>
  </div>
</footer>

<script>
/* La baliza. Le dice al worker que esta propuesta se abrio, y nada mas: el
   apodo del sitio. Sin cookies, sin terceros, sin nada del visitante.

   Va en try y con .catch: si el worker esta caido o alguien bloquea la
   peticion, la pagina no se entera. Una propuesta que se rompe por su propia
   medicion seria el peor de los mundos -- se pierde el prospecto Y el dato.

   `keepalive` para que sobreviva si cierran la pestana enseguida, que es justo
   cuando mas importa saber que la abrieron. */
(function () {{
  try {{
    fetch('https://daniel-agente.daniii.workers.dev/vista', {{
      method: 'POST',
      headers: {{ 'content-type': 'application/json' }},
      body: JSON.stringify({{ p: '{apodo}' }}),
      keepalive: true
    }}).catch(function () {{}});
  }} catch (e) {{}}
}})();
</script>

</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser(description='prospectos -> sitios')
    ap.add_argument('--prospectos', default='datos/prospectos.json')
    # Sale a `p/` DENTRO del repo a proposito: Cloudflare Pages ya esta
    # conectado a git, asi que un `git push` publica. Es el unico camino que no
    # necesita wrangler, ni token que caduque, ni un paso en el panel.
    ap.add_argument('--salida', default='p')
    ap.add_argument('--n', type=int, default=10, help='cuántos generar')
    ap.add_argument('--sector', default='', help='filtrar por sector SCIAN de 2 dígitos')
    args = ap.parse_args()

    with io.open(args.prospectos, encoding='utf-8') as f:
        prospectos = json.load(f)

    if args.sector:
        prospectos = [p for p in prospectos if p.get('sector') == args.sector]

    lote = prospectos[:args.n]
    os.makedirs(args.salida, exist_ok=True)

    indice = []
    for p in lote:
        carpeta = os.path.join(args.salida, p['apodo'])
        os.makedirs(carpeta, exist_ok=True)
        html = construir(p)
        with io.open(os.path.join(carpeta, 'index.html'), 'w', encoding='utf-8') as f:
            f.write(html)
        indice.append(p)
        print('  %-42s %s/  (%d KB)'
              % (p['nombre'][:42], p['apodo'], len(html.encode('utf-8')) // 1024))

    # El índice va FUERA de la carpeta que se publica. Escrito adentro —donde
    # estaba— `wrangler pages deploy` lo subía junto con los sitios y la lista
    # de a quién le estamos escribiendo quedaba en una URL pública. Cloudflare
    # sólo trata distinto a `_headers`, `_redirects` y `_routes.json`; cualquier
    # otro archivo que empiece con guion bajo se sirve igual que los demás.
    os.makedirs('datos', exist_ok=True)
    with io.open(os.path.join('datos', 'lote.json'), 'w', encoding='utf-8') as f:
        json.dump(indice, f, ensure_ascii=False, indent=1)

    print('\n%d sitios en %s/' % (len(lote), args.salida))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
