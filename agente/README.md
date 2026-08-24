# agente

El molde. Un worker que atiende el chat de **varias empresas a la vez**:
contesta lo que sabe y, cuando la conversación vale la pena, la convierte en un
contacto — una llamada agendada, un WhatsApp ya redactado, o un recado con
correo. Te avisa por Telegram en cuanto pasa, sin depender de que el visitante
toque nada, y deja todo escrito para que puedas leerlo después.

Cada empresa es un archivo en `src/clientes/`. La plomería no se toca.

Tres piezas que no son opcionales y explican casi todo el diseño:

- **La conversación vive en la base, no en el navegador.** Si el navegador
  manda el historial, cualquiera puede mandar turnos de *agente* inventados y
  ponerle palabras en la boca al tuyo.
- **La bandeja** (`/bandeja`) es donde lees lo que el agente dijo. Un agente
  cuyas conversaciones nadie ve no tiene supervisión, no deja rastro si un
  cliente reclama, y nadie se entera cuando alguien pidió ayuda y no se la
  dieron.
- **El verificador** corre de noche y cruza fuentes que deberían decir lo
  mismo. Sólo te escribe si no cuadran.

## Por qué existe este directorio

El portfolio es estático — GitHub Pages sirve archivos, no ejecuta código. Un
agente necesita servidor porque **la llave de la API no puede vivir en el
navegador**: cualquiera abre DevTools, la copia, y gasta con tu cuenta.

Así que el sitio se queda en Pages y esto vive en un Cloudflare Worker. El
navegador le habla al worker, y sólo el worker conoce la llave.

```
navegador ──POST──▶ worker ──▶ API de DeepSeek
   ▲                  │
   └──── SSE ─────────┘   (texto en streaming + los botones de acción)
```

## Por qué el código importa el SDK de Anthropic

Corre sobre DeepSeek, pero verás `import Anthropic from '@anthropic-ai/sdk'`.
No es un resto sin limpiar.

DeepSeek publica un endpoint **compatible con Anthropic** en
`https://api.deepseek.com/anthropic`, que habla exactamente la misma forma de
request: `system` como campo de arriba, `tools` con `input_schema`, `tool_choice`
y streaming igual. Es la ruta que DeepSeek documenta, y usarla deja el loop de
herramientas tal cual en vez de reescribirlo contra otro formato.

Lo que ese endpoint **no** acepta son las banderas propias de la plataforma de
Anthropic: nada de `betas`, `fallbacks` ni `output_config`. Por eso no están.

Si prefieres no depender de una capa de compatibilidad, la alternativa es el
endpoint nativo de DeepSeek en formato OpenAI (`https://api.deepseek.com` con
el SDK `openai`). Cambia la forma de los mensajes de herramientas —los
resultados van como `{role: 'tool', tool_call_id}` en vez de bloques
`tool_result`— así que es reescribir el loop, no cambiar una URL.

## Qué necesitas antes de empezar

- Una cuenta de Cloudflare (el plan gratis alcanza de sobra).
- Una llave de API de DeepSeek — `platform.deepseek.com`.
- Tu número de WhatsApp.
- Una página de reservas: Cal.com o el "appointment schedule" de Google
  Calendar. Cualquiera de las dos da una URL pública, que es lo único que el
  agente necesita.

## Desplegarlo

```bash
cd agente
npm install
npx wrangler login
```

Crea el almacén de los topes diarios y pega el `id` que imprime en
`wrangler.toml`, reemplazando `PENDIENTE_CORRER_wrangler_kv_namespace_create`:

```bash
npx wrangler kv namespace create CUOTA
```

Crea la base donde vive la conversación y aplica el esquema. Pega el
`database_id` que imprime el primer comando en `wrangler.toml`:

```bash
npx wrangler d1 create conversaciones
```

```bash
npx wrangler d1 execute conversaciones --remote --file=esquema.sql
```

Sin esto el agente contesta 503 a propósito. Falla ruidosamente porque la
alternativa —aceptar el historial que manda el navegador— es justo el agujero
que este molde vino a cerrar, y lo haría en silencio.

Carga los secretos. Cada comando pide el valor y no queda en el repo:

```bash
npx wrangler secret put DEEPSEEK_API_KEY
```

```bash
npx wrangler secret put WHATSAPP_E164
```

```bash
npx wrangler secret put CAL_URL
```

```bash
npx wrangler secret put BANDEJA_TOKEN
```

`BANDEJA_TOKEN` es la única puerta a conversaciones de gente real. Genera uno
largo y al azar, y no lo reuses en otro lado.

`WHATSAPP_E164` va en formato internacional **sin `+` y sin espacios** —
`528112345678`. `CAL_URL` es la página completa, por ejemplo
`https://cal.com/daniel/30min`.

```bash
npm run deploy
```

Wrangler imprime la URL del worker. Cópiala.

## Conectarlo al sitio

Al final de `../index.html` está la línea que apunta al worker:

```js
var ENDPOINT = 'https://daniel-agente.daniii.workers.dev/';
```

Si se vacía, **el botón deja de dibujarse** — el sitio nunca muestra un chat
roto, simplemente no hay chat. Es el interruptor para apagarlo sin desplegar.

## Que te avise de cada lead

Sin esto dependes de que el visitante toque el botón. Alguien puede leer el
mensaje de WhatsApp que el agente le redactó, cerrar la pestaña y nunca
enviarlo: para ti ese lead no existió. Con el aviso, te llega igual.

El worker te escribe por Telegram cada vez que alguien pide agendar, pide el
WhatsApp o deja un recado — con lo que quería y las últimas seis vueltas de la
conversación.

Montarlo son dos minutos, todo dentro de Telegram:

1. Habla con **@BotFather** y manda `/newbot`. Le pones nombre y usuario, y te
   devuelve un token como `123456789:AAG...`.
2. Habla con **@userinfobot** y manda cualquier cosa. Te contesta con tu `Id`
   numérico — ese es el `chat_id`.
3. **Mándale un mensaje a tu bot nuevo**, el que sea. Telegram no deja que un
   bot escriba primero, así que sin este paso el aviso nunca llega.

```bash
npx wrangler secret put TELEGRAM_TOKEN
```

```bash
npx wrangler secret put TELEGRAM_CHAT_ID
```

Los dos son opcionales: sin ellos el agente funciona igual, sólo que en silencio.

Ojo con lo que viaja: el nombre, el correo y el mensaje que deje un visitante
llegan a ese chat de Telegram. Es el punto —es tu lead— pero tenlo presente si
alguna vez compartes la pantalla.

## Llenar el perfil

`src/clientes/daniel.js` empieza con un bloque `PERFIL`. Ahí está lo que el agente da
por cierto sobre ti, y lo va a repetir a desconocidos.

Dejé vacías, marcadas con `PENDIENTE`, las cosas que sólo tú sabes: dónde vives,
a qué te dedicas, qué encargos te interesan, tu disponibilidad. **No las
inventé.** Mientras estén así el agente dice que no sabe y ofrece pasar el
contacto — que es mejor que mentirle a alguien que te está considerando.

Debajo están las instrucciones de tono y las tres herramientas. Cualquier cambio
necesita `npm run deploy` otra vez.

## Lo que cuesta

Corre con `deepseek-v4-pro`. En hora pico son 1.32 USD por millón de tokens de
entrada y 3.96 por millón de salida, así que un mensaje de portfolio —unos
2.000 tokens de entrada y 300 de salida— sale en **medio centavo de dólar**.
Fuera de pico cuesta la mitad: el descuento aplica salvo de 01:00 a 04:00 y de
06:00 a 10:00 UTC, de lunes a viernes.

Los topes están en `src/index.js`:

| Constante | Valor | Qué frena |
| --- | --- | --- |
| `TOPE_POR_IP` | 40 / día | Que una persona se quede pegada al chat |
| `TOPE_GLOBAL` | 800 / día | Tu gasto total, pase lo que pase |

Con esos números el peor día posible son **unos 3 USD**, y eso es con el chat
saturado las 24 horas. Para un portfolio es un techo cómodo; si aun así quieres
apretarlo, baja `TOPE_GLOBAL`.

La otra palanca es el modelo: `deepseek-v4-flash` cuesta la tercera parte, a
cambio de respuestas menos finas. Lo dejé en `-pro` porque a este precio la
diferencia de gasto es de centavos y esa decisión es tuya.

El caché de DeepSeek abarata mucho la entrada repetida —de 1.32 a 0.044 por
millón cuando pega— y el prompt del sistema es idéntico en cada llamada, así
que en la práctica vas a pagar bastante menos que la cuenta de arriba.

## Ver qué está pasando

```bash
npm run logs
```

Muestra las peticiones en vivo. Los errores del agente se escriben ahí con
`console.error` — el visitante sólo ve un mensaje genérico, nunca el detalle.

## Cómo está armado

| Archivo | Qué es |
| --- | --- |
| `src/clientes/daniel.js` | Una empresa: perfil, tono, herramientas, topes y orígenes. **Es el que se copia.** |
| `src/clientes/index.js` | El registro. Dar de alta una empresa son dos líneas aquí |
| `src/index.js` | Plomería: origen, topes, sesión, el loop de herramientas y el streaming |
| `src/almacen.js` | Dónde vive la conversación. Todo lo que toca la base pasa por aquí |
| `src/bandeja.js` | La bandeja y su página, protegidas por token |
| `src/avisos.js` | La entrega por Telegram — de leads y del parte del verificador |
| `src/verificador.js` | El cron que cruza fuentes y sólo habla si algo no cuadra |
| `esquema.sql` | Las tres tablas: sesiones, mensajes, avisos |
| `wrangler.toml` | Worker, cuotas, base y el horario del verificador |

El widget del navegador no está aquí: vive al final de `../index.html`, fuera
del bloque `<x-dc>`, para que una sincronización desde Claude Design no se lo
lleve por delante.

### Decisiones que no son obvias

- **El navegador no manda historial: manda un id de sesión.** Antes mandaba los
  turnos, y aunque se rechazaban los bloques crudos, se aceptaba
  `{rol:'agente'}` tal cual — o sea, cualquiera podía ponerle palabras en la
  boca al agente y arrancar desde ahí. Ahora el texto que el modelo recibe como
  suyo es el que nosotros escribimos en la base.
- **El id de sesión lo genera el servidor**, con 122 bits de aleatoriedad, y se
  comprueba que sea del mismo cliente antes de usarlo. Si no cuadra se abre una
  sesión nueva sin decir por qué: explicar el motivo es decirle a quien prueba
  ids qué tan cerca estuvo.
- **El cliente lo decide el origen, no un campo del cuerpo.** Un campo lo
  escribe el navegador, y entonces cualquiera podría gastarse la cuota ajena o
  escribir en la bandeja de otra empresa.
- **El aviso se escribe antes de intentar entregarlo.** Al revés, un fallo de
  Telegram borraría el lead del mundo. Así queda constancia, y si la entrega
  falla el verificador lo encuentra esa noche.
- **El texto del modelo se pinta con `textContent`, nunca con `innerHTML`.** Lo
  que escribe el agente es texto, no marcado.
- **Las herramientas no tocan red.** Sólo arman una URL o un aviso, así que el
  loop no puede quedarse colgado esperando algo de afuera. El único fetch extra
  es el de Telegram, y va aparte: si falla, la conversación del visitante sigue.
- **El aviso se recoge antes de cerrar el stream.** Al cerrarlo el worker puede
  terminar, y una notificación a medio salir se perdería en silencio.
- **CORS lo decide el servidor.** Un origen que no esté en la ficha de ningún
  cliente recibe 403
  antes de que se toque la API.
- **Un turno nunca termina en silencio.** Si el modelo declina, se corta, o sólo
  llama herramientas sin decir nada, el worker manda una línea de salida. Sin
  eso el visitante se queda mirando una burbuja vacía.

## Dar de alta otra empresa

1. Copia `src/clientes/daniel.js` a `src/clientes/acme.js`.
2. Cambia el perfil, el sistema, las herramientas, el `id`, el `nombre` y los
   `origenes`. Los orígenes son la llave: dos empresas nunca pueden compartir
   uno, y el registro revienta al arrancar si lo intentas.
3. Prefija sus secretos y decláralos en su `ajustes`:

```bash
npx wrangler secret put ACME_WHATSAPP_E164
```

4. Regístrala en `src/clientes/index.js` — importarla y meterla en `FICHAS`.
5. Despliega. No hay migración de base: la columna `cliente` ya la separa.

Las herramientas se nombran **en español y con el vocabulario de la empresa**
(`estado_de_los_datos`, `producto_en_tienda`). El nombre de la herramienta es
parte del prompt: un nombre malo produce llamadas malas.

## La bandeja

Vive en `https://tu-worker.workers.dev/bandeja`. Pide el token una vez y lo
guarda en el navegador; nunca viaja en la URL, porque las URLs quedan en
historiales y en logs.

Ves la lista de conversaciones por actividad, cuáles traen lead, cuáles no has
abierto, y el hilo completo. Un aviso marcado **NO ENTREGADO** es un lead que
existió y no te llegó.

## El verificador

Corre todos los días a las 9:00 UTC. Su única idea: *todos los errores se
encuentran comparando una fuente contra otra*. Hoy hace cuatro comprobaciones:

1. Avisos escritos que no se entregaron en 24 h.
2. El contador de cuota (KV) contra los turnos guardados (base). Son caminos
   distintos: si se separan mucho, uno de los dos no está corriendo.
3. Conversaciones con lead que llevan más de un día sin abrir.
4. Mensajes sin sesión — no debería pasar nunca; si pasa, algo escribe por
   fuera del almacén.

Si todo cuadra **no te escribe**. Un parte diario de "todo bien" se vuelve
ruido y dejas de leerlo.

Para probarlo en local, el servidor de desarrollo acepta:

```bash
curl "http://localhost:8787/__scheduled?cron=0+9+*+*+*"
```

## Lo que este agente no hace

No manda mensajes por WhatsApp por su cuenta: eso necesita WhatsApp Business
Platform, con cuenta de Meta Business, número dedicado y verificación. Lo que
hace es preparar el mensaje y dárselo al visitante ya escrito; cuando esa
persona lo envía, a ti te llega un WhatsApp real con contexto, desde su número.
Para la mayoría de los portfolios eso es suficiente y cuesta cero.
