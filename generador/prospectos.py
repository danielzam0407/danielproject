# -*- coding: utf-8 -*-
"""Del DENUE a una lista de prospectos con la que se puede trabajar.

   La fuente es el DENUE del INEGI, no Google Maps. Eso no es una preferencia:
   raspar Maps viola sus términos, se rompe cuando Google mueve un div, y no es
   base sobre la que montar el motor de ventas de nadie. El DENUE es oficial,
   gratuito, se baja completo por estado sin token, y —esto es lo importante—
   **su campo `www` vacío ES la señal de compra**. No hay que inferir nada: el
   registro dice que no tienen sitio.

       https://www.inegi.org.mx/contenidos/masiva/denue/denue_19_csv.zip
       (19 = Nuevo León, 21.5 MB, 211,349 registros, latin-1)

   La trampa del listado en crudo: el primer lugar por giro son escuelas
   públicas, y detrás sucursales bancarias, oficinas de gobierno y rutas de
   camión. Ninguno compra. Por eso se excluyen los sectores SCIAN 61, 52 y 93
   antes de contar nada — una lista sin filtrar es basura con volumen.

   Uso:
       python generador/prospectos.py <ruta-del-csv> [--salida datos/prospectos.json]
"""

import argparse
import csv
import io
import json
import os
import re
import sys
import unicodedata

# La zona metropolitana de Monterrey. Fuera de aquí una visita cuesta medio día.
ZMM = {
    'monterrey', 'san pedro garza garcia', 'san nicolas de los garza', 'guadalupe',
    'apodaca', 'general escobedo', 'santa catarina', 'juarez', 'garcia',
    'cadereyta jimenez', 'salinas victoria', 'pesqueria', 'santiago', 'el carmen',
    'cienega de flores', 'general zuazua', 'hidalgo', 'abasolo',
}

# 11 empleados es el corte donde un negocio ya tiene a alguien que decide y
# presupuesto que aprobar. Por debajo, quien contesta el teléfono es el dueño
# y está atendiendo el mostrador.
TAMANOS = ('11 a 30', '31 a 50', '51 a 100', '101 a 250', '251 y')

# 61 educación, 52 finanzas, 93 gobierno. No compran, y llenan la lista.
SECTORES_FUERA = {'61', '52', '93'}

# Los giros que embonan con lo que Daniel hace, por sector SCIAN de dos dígitos.
# Industrial y construcción antes que comercio; restaurantes hasta abajo — ticket
# bajo y muchos usan Instagram a propósito, no por descuido.
PESO_SECTOR = {
    '31': 40, '32': 40, '33': 40,   # manufactura
    '23': 35,                        # construcción
    '54': 30,                        # servicios profesionales
    '43': 25,                        # comercio al por mayor
    '56': 20,                        # servicios de apoyo a negocios
    '48': 15, '49': 15,              # transporte
    '46': 10,                        # comercio al por menor
    '81': 8,                         # otros servicios
    '53': 8,                         # inmobiliarios
    '51': 8,                         # información
    '62': 5,                         # salud
    '71': 3,                         # esparcimiento
    '72': 0,                         # alojamiento y restaurantes
}

# La ficha de arte de cada sector. Vive aquí y no en el generador porque es una
# decisión de negocio —a quién le hablamos y con qué cara— y no de plantilla.
#
# Los acentos NO se inventan: son los tres que el sistema sanciona
# (`opendesign/DESIGN.md` §2), uno por pieza y nunca juntos. Inventar un color
# por negocio se sentiría a la medida y rompería el contraste medido.
ARTE_SECTOR = {
    '31': ('negro', 'acido'), '32': ('negro', 'acido'), '33': ('negro', 'acido'),
    '23': ('papel', 'rojo'),
    '54': ('papel', 'azul'),
    '43': ('papel', 'azul'),
    '56': ('papel', 'azul'),
    '48': ('negro', 'azul'), '49': ('negro', 'azul'),
    '46': ('papel', 'rojo'),
    '53': ('papel', 'azul'),
    '51': ('negro', 'azul'),
    '62': ('papel', 'azul'),
    '81': ('papel', 'rojo'),
}


def sin_acentos(texto):
    return ''.join(
        c for c in unicodedata.normalize('NFD', texto)
        if unicodedata.category(c) != 'Mn'
    )


def clave(texto):
    return sin_acentos((texto or '').strip().lower())


def apodo(nombre, usados):
    """El nombre del negocio convertido en algo que cabe en un subdominio.

       Se le pega un sufijo cuando choca: en el DENUE hay decenas de
       'FERRETERIA GONZALEZ' y dos prospectos distintos no pueden compartir
       dirección — el segundo sobrescribiría al primero sin avisar."""
    base = re.sub(r'[^a-z0-9]+', '-', clave(nombre)).strip('-')[:40].strip('-')
    if not base:
        base = 'negocio'
    corto = base
    n = 2
    while corto in usados:
        corto = '%s-%d' % (base[:36].strip('-'), n)
        n += 1
    usados.add(corto)
    return corto


def calle(fila):
    partes = [
        (fila.get('tipo_vial') or '').strip().title(),
        (fila.get('nom_vial') or '').strip().title(),
        (fila.get('numero_ext') or '').strip(),
    ]
    return ' '.join(p for p in partes if p)


CORREO_VALIDO = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]{2,}$')


def leer(ruta):
    usados = set()
    prospectos = []

    with io.open(ruta, encoding='latin-1', newline='') as f:
        for fila in csv.DictReader(f):
            if clave(fila.get('municipio')) not in ZMM:
                continue
            if not (fila.get('per_ocu') or '').strip().startswith(TAMANOS):
                continue

            sector = (fila.get('codigo_act') or '')[:2]
            if sector in SECTORES_FUERA:
                continue

            nombre = (fila.get('nom_estab') or '').strip()
            if not nombre or 'SECTOR PUBLICO' in nombre.upper():
                continue

            # LA señal. Si ya tienen sitio, no son prospecto de esto.
            if (fila.get('www') or '').strip():
                continue

            correo = (fila.get('correoelec') or '').strip().lower()
            if not CORREO_VALIDO.match(correo):
                correo = ''
            telefono = re.sub(r'\D', '', (fila.get('telefono') or ''))
            if len(telefono) not in (10, 12, 13):
                telefono = ''

            # Sin correo ni teléfono no hay a dónde escribirle: es un registro,
            # no un prospecto.
            if not correo and not telefono:
                continue

            ground, acento = ARTE_SECTOR.get(sector, ('papel', 'azul'))
            puntaje = PESO_SECTOR.get(sector, 5) + (12 if correo else 0)

            prospectos.append({
                'id': (fila.get('id') or '').strip(),
                'apodo': apodo(nombre, usados),
                'nombre': nombre,
                'razon_social': (fila.get('raz_social') or '').strip(),
                'giro': (fila.get('nombre_act') or '').strip(),
                'codigo_act': (fila.get('codigo_act') or '').strip(),
                'sector': sector,
                'personal': (fila.get('per_ocu') or '').strip(),
                'calle': calle(fila),
                'colonia': (fila.get('nomb_asent') or '').strip().title(),
                'cp': (fila.get('cod_postal') or '').strip(),
                'municipio': (fila.get('municipio') or '').strip(),
                'telefono': telefono,
                'correo': correo,
                'lat': (fila.get('latitud') or '').strip(),
                'lon': (fila.get('longitud') or '').strip(),
                'alta': (fila.get('fecha_alta') or '').strip(),
                'ground': ground,
                'acento': acento,
                'puntaje': puntaje,
            })

    prospectos.sort(key=lambda p: (-p['puntaje'], p['nombre']))
    return prospectos


def main():
    ap = argparse.ArgumentParser(description='DENUE -> prospectos.json')
    ap.add_argument('csv', help='ruta a denue_inegi_19_.csv')
    ap.add_argument('--salida', default='datos/prospectos.json')
    args = ap.parse_args()

    if not os.path.exists(args.csv):
        print('no encuentro el csv: %s' % args.csv, file=sys.stderr)
        return 1

    prospectos = leer(args.csv)
    carpeta = os.path.dirname(args.salida)
    if carpeta:
        os.makedirs(carpeta, exist_ok=True)
    with io.open(args.salida, 'w', encoding='utf-8') as f:
        json.dump(prospectos, f, ensure_ascii=False, indent=1)

    con_correo = sum(1 for p in prospectos if p['correo'])
    print('prospectos ............. %6d' % len(prospectos))
    print('  con correo ........... %6d  (%d%%)'
          % (con_correo, 100 * con_correo // max(len(prospectos), 1)))
    print('  escrito en ........... %s' % args.salida)
    print('\nlos 10 mejores por puntaje:')
    for p in prospectos[:10]:
        print('  %3d  %-42s %s' % (p['puntaje'], p['nombre'][:42], p['giro'][:40]))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
