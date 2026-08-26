# -*- coding: utf-8 -*-
"""Verifica los criterios de is-agentic contra un sitio en vivo.

  python verificar-agentes.py                       # produccion
  python verificar-agentes.py http://localhost:8788 # local

Comprueba lo que se puede comprobar desde fuera. No sustituye a is-agentic:
sirve para no volver a romper lo que ya se arreglo.
"""
import sys, json, re, urllib.request, urllib.error

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'https://nervcenter.online').rstrip('/')
UA = {'User-Agent': 'verificador-nerv/1.0'}
fallos = []


def pedir(ruta, cabeceras=None):
    h = dict(UA)
    if cabeceras:
        h.update(cabeceras)
    pet = urllib.request.Request(BASE + ruta, headers=h)
    try:
        with urllib.request.urlopen(pet, timeout=25) as r:
            return r.status, dict(r.headers), r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode('utf-8', 'replace')


def revisar(nombre, ok, detalle=''):
    print('  [%s] %-42s %s' % ('OK' if ok else '--', nombre, detalle))
    if not ok:
        fallos.append(nombre)


print('Verificando %s' % BASE)
print()

# 1. 404 de verdad
est, _, cuerpo = pedir('/esta-ruta-no-existe-' + '9' * 6)
revisar('404 real en ruta inexistente', est == 404, 'HTTP %s' % est)
revisar('404 apunta a sitemap o llms.txt',
        'llms.txt' in cuerpo or 'sitemap' in cuerpo)

# 2. Contenido sin JavaScript
est, _, html = pedir('/')
texto = ' '.join(re.sub(r'<script.*?</script>|<style.*?</style>|<[^>]+>', ' ',
                        html, flags=re.S).split())
enc = re.findall(r'<h([1-6])', html)
revisar('portada responde 200', est == 200)
revisar('texto crudo >= 500 caracteres', len(texto) >= 500, '%d' % len(texto))
revisar('tiene h1', '1' in enc)
revisar('el h1 va antes que los demas', bool(enc) and enc[0] == '1')
revisar('jerarquia con h2 y h3', '2' in enc and '3' in enc, ''.join(enc))

# 3. Negociacion de markdown
est, cab, cuerpo = pedir('/', {'Accept': 'text/markdown'})
ct = cab.get('Content-Type', '')
vary = cab.get('Vary', '')
revisar('Accept: text/markdown devuelve markdown', 'markdown' in ct.lower(), ct)
revisar('Vary incluye Accept', 'accept' in vary.lower().split(','[0])
        and re.search(r'\baccept\b', vary, re.I) is not None, vary)

# Toda ruta que el middleware promete en markdown tiene que cumplirlo. Arriba
# solo se miraba la portada, y por eso /privacy estuvo mapeado en EQUIVALENTES
# sin su .md: caia con gracia al HTML, con estado 200, y nadie se quejaba.
for ruta in ['/about', '/contact', '/privacy']:
    _, cab, _ = pedir(ruta, {'Accept': 'text/markdown'})
    ct = cab.get('Content-Type', '')
    revisar('%s negocia markdown' % ruta, 'markdown' in ct.lower(), ct)

# 5 y 8. JSON-LD y Organization
m = re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
revisar('hay JSON-LD en la portada', m is not None)
if m:
    try:
        d = json.loads(m.group(1))
        nodos = d.get('@graph', [d])
        org = next((x for x in nodos if x.get('@type') == 'Organization'), None)
        revisar('JSON-LD valida como JSON', True)
        revisar('incluye Organization', org is not None)
        if org:
            revisar('Organization con name/url/description',
                    all(k in org for k in ('name', 'url', 'description')))
            revisar('Organization con contactPoint', 'contactPoint' in org)
            revisar('Organization con address', 'address' in org)
    except Exception as e:
        revisar('JSON-LD valida como JSON', False, str(e)[:40])

# 6. llms.txt con cuando usarlo
est, _, llms = pedir('/llms.txt')
revisar('/llms.txt existe', est == 200, 'HTTP %s' % est)
revisar('llms.txt dice cuando usarlo',
        re.search(r'cu[aá]ndo usar|when to use', llms, re.I) is not None)

# 7. sitemap
est, _, sm = pedir('/sitemap.xml')
revisar('/sitemap.xml existe', est == 200, 'HTTP %s' % est)
revisar('sitemap con <loc> y <lastmod>', '<loc>' in sm and '<lastmod>' in sm)

est, _, rb = pedir('/robots.txt')
revisar('/robots.txt existe', est == 200, 'HTTP %s' % est)
revisar('robots.txt anuncia el sitemap', 'sitemap' in rb.lower())

# 9. Paginas de confianza
for ruta in ['/about', '/contact', '/privacy']:
    est, _, h = pedir(ruta)
    t = ' '.join(re.sub(r'<script.*?</script>|<style.*?</style>|<[^>]+>', ' ',
                        h, flags=re.S).split())
    revisar('%s con 500+ caracteres' % ruta, est == 200 and len(t) >= 500,
            'HTTP %s, %d car' % (est, len(t)))

print()
if fallos:
    print('FALLARON %d:' % len(fallos))
    for f in fallos:
        print('   - %s' % f)
    sys.exit(1)
print('Todo en orden.')
