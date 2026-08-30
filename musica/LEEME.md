# El catálogo

43 ejercicios con prerrequisitos. **Es el producto.** El modelo no inventa
ejercicios: escoge de aquí y les ajusta el tamaño.

## Por qué existe

Si el modelo improvisa el plan de estudio cada sesión, da cosas que suenan bien
y no construyen una sobre otra — y en tres semanas estás igual que con los
videos de YouTube. El catálogo se escribe una vez; el trabajo del modelo es
**escoger el siguiente nodo y ajustarle el tempo**, leyendo la bitácora.

Es la misma disciplina de fichas del agente del sitio, aplicada a la enseñanza:
el modelo mueve parámetros, nunca escribe el contenido.

## Las reglas que el catálogo da por hechas

1. **Cero notación.** Ningún `dice` menciona un pentagrama, una tablatura ni una
   figura rítmica. Los patrones van como `A a A a` (abajo/arriba) y los acordes
   por nombre. Si la pantalla llega a pedir leer, se rompió.
2. **Nunca "¿qué quieres practicar hoy?"** El agente propone; Daniel acepta o
   pide otra cosa. Esa pregunta es justo la que lo dejó tocando acordes al azar.
3. **La sesión tiene final.** 12 minutos: 3 de calentamiento, 6 del bloque del
   día, 3 libres. **El bloque del día es UNO**; tres bloques distintos en seis
   minutos es turismo, no práctica.
4. **El cierre no se mide.** `lib-jam` existe para que tocar por tocar deje de
   ser el problema y pase a ser el premio.
5. **Todo termina en un número que sube.** Es lo único que convierte "no sé si
   estoy mejorando" en evidencia.

## El esquema

```jsonc
{
  "id": "cam-em-am",           // único; el prefijo es el bloque
  "bloque": "cambios",
  "nombre": "…",               // lo que ve en pantalla
  "dice": "…",                 // la instrucción, una línea, sin notación
  "requiere": ["ac-em", …],    // ids que deben estar aprobados antes
  "mide": "cambios_por_minuto",// una clave de `medidas`
  "aprobar": 30,               // umbral; el sentido lo da `medidas[…].sentido`
  "duracion_s": 60,
  "ficha": { … }               // lo que el motor necesita para tocarlo y dibujarlo
}
```

`medidas` define cada medición, si **sube o baja** para aprobar, cómo se calcula
y qué necesita del micrófono. Se lee de ahí, no se adivina del nombre.

## Dos cosas que hay que hacer antes de confiar en un número

**1 · Calibrar el desfase. Obligatorio.** Toda medida en `desviacion_ms` incluye
la ida y vuelta del navegador y de la interfaz. Sin restar ese desfase constante
—tocar contra el clic, medir la media, guardarla— los ejercicios de ritmo miden
el sistema y no a él. Se calibra al inicio de cada sesión, no una vez y ya: la
cifra cambia si cambia el buffer o el dispositivo.

**2 · Los tres interruptores de Chrome.** `echoCancellation`, `noiseSuppression`
y `autoGainControl` van en `false` explícitamente al pedir el micrófono. Vienen
en `true` por omisión, son para videollamadas y destrozan la medición: el AGC
mueve la amplitud —adiós al ataque— y la supresión de ruido se come los
armónicos que YIN necesita.

Y practicar **limpio**: YIN se equivoca de octava con señales de muchos
armónicos, o sea con distorsión.

## Lo que NO está resuelto

- **Los umbrales de `aprobar` son valores de arranque, no verdad.** Están puestos
  para que el primer día no frustre y el décimo no aburra. Se recalibran en la
  semana 3 con sus datos reales — ése es el trabajo, no un pendiente.
- **`cuerdas_limpias` es la medición menos fiable de la lista.** Detectar si las
  seis cuerdas de un acorde suenan es análisis polifónico, que es otra liga que
  YIN monofónico. Si en la semana 2 no da algo estable, los ejercicios de
  `acordes` pasan a evaluarse por la nota más grave y la limpieza general, y el
  umbral se ajusta. Está marcado como hueco, no tapado.
- **El catálogo se detiene antes de la cejilla.** Es a propósito: es donde más
  gente abandona, y no vale la pena diseñarlo hasta ver cómo le va con los
  cambios abiertos.
- **No soy su maestro de guitarra.** Los ejercicios son de los establecidos y
  medibles —cambios en un minuto, araña cromática, permutaciones, pentatónica—,
  no inventados. Si él tiene un método que le cae bien, se cambian por ésos.

## Verificar

```bash
node validar.mjs
```

Comprueba que no haya prerrequisitos colgando, ni ciclos, ni medidas
inexistentes, y que todo ejercicio sea alcanzable desde alguna raíz.
