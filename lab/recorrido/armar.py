# -*- coding: utf-8 -*-
"""Convierte los renders sueltos de un constructor en un recorrido navegable.

    python armar.py <carpeta-de-renders> [salida.mp4]

El caso real: un constructor tiene 8 o 12 renders estaticos para su folleto.
No tiene video de recorrido, y no se puede hacer scrubbing entre imagenes
sueltas. Esto genera el movimiento que falta y lo deja listo para scrub.

Tres pasos:

  1. Cada render recibe un empuje de camara lento (zoom y desplazamiento).
     Es el efecto Ken Burns: no inventa geometria, pero convierte una foto
     quieta en una toma. Es lo que hace que se lea como recorrido y no como
     carrusel.
  2. Las tomas se encadenan con fundidos, no con cortes secos. Un corte entre
     cuartos se siente a saltos cuando el dedo lo controla.
  3. El resultado se encodea con TODOS los cuadros como keyframe.

El paso 3 no es opcional y es la razon de ser de este archivo. Medido en
celular el 2026-08-25: el mismo material con encode normal tarda 407 ms (p90)
en saltar a un cuadro; con -g 1 baja a 30 ms. Trece veces. Sin eso, el
recorrido se ve entrecortado y no hay codigo que lo arregle.
"""
import os
import subprocess
import sys

SEG_POR_RENDER = 3.5     # cuanto dura cada toma
SEG_FUNDIDO = 0.9        # traslape entre una y la siguiente
ANCHO = 768              # 768 y crf 32 fue el punto medido: 1.96 MB, 30 ms
FPS = 30
EXTS = ('.jpg', '.jpeg', '.png', '.webp')


def ffmpeg(args):
    r = subprocess.run(['ffmpeg', '-y', '-v', 'error'] + args,
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip()[:400])


def renders_de(carpeta):
    nombres = sorted(f for f in os.listdir(carpeta) if f.lower().endswith(EXTS))
    if not nombres:
        raise SystemExit('No encontre imagenes en %s' % carpeta)
    return [os.path.join(carpeta, n) for n in nombres]


def toma(entrada, salida, indice):
    """Un render quieto -> una toma con empuje de camara.

    La direccion alterna por indice: si todas las tomas empujan igual, el
    recorrido completo se siente mecanico. Alternar lee como intencion.
    """
    cuadros = int(SEG_POR_RENDER * FPS)
    hacia_dentro = (indice % 2 == 0)
    z = ("'min(1.18, 1.001+0.0011*on)'" if hacia_dentro
         else "'max(1.02, 1.18-0.0011*on)'")
    # El zoompan trabaja sobre una version grande para que el acercamiento no
    # muestre los pixeles del original.
    vf = ("scale=%d:-2," % (ANCHO * 3) +
          "zoompan=z=%s:d=%d:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
          % (z, cuadros) +
          ":s=%dx%d:fps=%d," % (ANCHO, int(ANCHO * 9 / 16), FPS) +
          "format=yuv420p")
    ffmpeg(['-loop', '1', '-i', entrada, '-t', str(SEG_POR_RENDER),
            '-vf', vf, '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast',
            '-an', salida])


def encadenar(tomas, salida, tmp):
    """Une las tomas con fundidos encadenados."""
    if len(tomas) == 1:
        os.replace(tomas[0], salida)
        return
    actual = tomas[0]
    acumulado = SEG_POR_RENDER
    for i, siguiente in enumerate(tomas[1:], start=1):
        paso = os.path.join(tmp, 'union%02d.mp4' % i)
        offset = max(0.0, acumulado - SEG_FUNDIDO)
        ffmpeg(['-i', actual, '-i', siguiente,
                '-filter_complex',
                'xfade=transition=fade:duration=%s:offset=%s,format=yuv420p'
                % (SEG_FUNDIDO, round(offset, 3)),
                '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast',
                '-an', paso])
        actual = paso
        acumulado += SEG_POR_RENDER - SEG_FUNDIDO
    os.replace(actual, salida)


def para_scrub(entrada, salida):
    """El paso que decide si esto se siente fluido o roto.

    -g 1            cada cuadro es keyframe
    -keyint_min 1   sin distancia minima entre keyframes
    -sc_threshold 0 sin keyframes extra por deteccion de corte
    """
    ffmpeg(['-i', entrada, '-c:v', 'libx264', '-g', '1', '-keyint_min', '1',
            '-sc_threshold', '0', '-crf', '32', '-preset', 'slow', '-an',
            '-movflags', '+faststart', '-vf', 'scale=%d:-2' % ANCHO, salida])


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    carpeta = sys.argv[1]
    salida = sys.argv[2] if len(sys.argv) > 2 else 'recorrido.mp4'

    imgs = renders_de(carpeta)
    tmp = os.path.join(carpeta, '.tmp-recorrido')
    os.makedirs(tmp, exist_ok=True)
    print('%d renders encontrados' % len(imgs))

    tomas = []
    for i, img in enumerate(imgs):
        t = os.path.join(tmp, 'toma%02d.mp4' % i)
        toma(img, t, i)
        tomas.append(t)
        print('  toma %2d/%d  %s' % (i + 1, len(imgs), os.path.basename(img)))

    crudo = os.path.join(tmp, 'encadenado.mp4')
    print('encadenando con fundidos...')
    encadenar(tomas, crudo, tmp)

    print('reencodeando para scrub (-g 1)...')
    para_scrub(crudo, salida)

    mb = os.path.getsize(salida) / 1048576.0
    dur = len(imgs) * SEG_POR_RENDER - (len(imgs) - 1) * SEG_FUNDIDO
    print('')
    print('listo: %s' % salida)
    print('  %.2f MB  ·  ~%.1f s  ·  ~%d cuadros de recorrido'
          % (mb, dur, int(dur * FPS)))
    print('')
    print('Si pesa mas de 3 MB, baja ANCHO o sube el crf de para_scrub().')
    print('Los prospectos lo abren con datos moviles.')


if __name__ == '__main__':
    main()
