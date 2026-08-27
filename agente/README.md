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

## Que también conteste por WhatsApp (Kapso)

Hasta aquí el agente vivía sólo en el sitio, y su escalada era un botón
`wa.me` que abría tu WhatsApp personal: la conversación se te entregaba a mano
y ahí se acababa el agente. Con esto la sigue él — mismo perfil, misma base,
misma cuota— y a ti te llega el aviso igual.

El código ya está desplegado y **apagado**: sin los tres secretos de abajo,
`/whatsapp` contesta 503 y no gasta un peso. Encenderlo son los pasos de esta
sección.

### Antes que nada: tu número personal NO va aquí

Conectar un número a la API de WhatsApp Business **lo migra a la Cloud API y
pierdes la app de WhatsApp en ese número**. Deja de funcionar en tu teléfono,
va en una sola dirección, y recuperarlo es un trámite con Meta.

Kapso da un **número pre-verificado en su plan gratis**. Ése es el que va. Tu
número personal se queda como está.

### 1. La cuenta

1. Alta en <https://kapso.com>.
2. Toma el número pre-verificado que te dan (o conecta uno **que no uses en el
   teléfono**).
3. `Project Settings > API Keys` → crea una llave de proyecto. Es
   `KAPSO_API_KEY`.
4. En el número, copia su **phone number ID**. No es el teléfono: es el
   identificador que Meta le da al número, quince dígitos. Es
   `KAPSO_NUMERO_ID`.

### 2. El webhook — en la pestaña **WhatsApp**, no en Platform

Esto es lo primero que se hace mal. En `Webhooks` hay dos pestañas y sólo una
sirve:

| Pestaña | Qué manda | ¿Nos sirve? |
|---|---|---|
| **Platform** (*Project webhooks*) | ciclo de vida, workflows, agent runs | **No.** No manda mensajes. Si lo pones ahí no llega nada. |
| **WhatsApp** | mensajes y conversaciones, **por número** | Sí |

Los webhooks de mensajes son **por número**: abres el número conectado, le das
al **lápiz (Edit)** y ahí va la URL.

- **URL**: `https://daniel-agente.daniii.workers.dev/whatsapp`
- **Kind**: `kapso`. **No `meta`.** `meta` reenvía el formato crudo de Meta
  (`entry[].changes[].value.messages[]`, firma en `X-Hub-Signature-256`) y este
  worker no lo entiende: lee el formato de Kapso —`message`, `conversation`,
  `phone_number_id` arriba— y la firma en `X-Webhook-Signature`. Con `meta` no
  falla ruidosamente: ignora todo con un 200.
- **Payload version**: `v2`, si te lo pregunta.
- **Eventos**: deja **sólo** `Message received`. El panel llega con los once
  marcados, y el caro es **`Message sent`**: es el aviso de lo que el agente
  acaba de mandar, o sea el agente contestándose a sí mismo en bucle y pagando
  cada vuelta. El worker los descarta por el nombre del evento y está probado
  —ni con el campo `direction` ausente se cuela—, pero desmarcarlos ahorra
  entregas que no sirven para nada.
- **Buffering**: déjalo **apagado** para la primera prueba. Sirve para juntar
  en un sobre los mensajes que alguien escribe seguidos, pero mete la espera de
  su ventana antes de contestar. El worker atiende las dos formas —el sobre lo
  procesa en orden y en el mismo hilo—, así que enciéndelo después si ves que
  la gente escribe en pedacitos.
- Copia el **secreto que genera**. Es `KAPSO_WEBHOOK_SECRET`, y es la **única**
  puerta de ese endpoint: un webhook no manda cabecera `Origin`, así que el
  control de origen que protege todo lo demás no aplica ahí.

### 3. Los tres secretos

Se ponen uno por uno, y **los escribes tú**: un secreto que pasa por el chat de
alguien más deja de ser secreto.

```
npx wrangler secret put KAPSO_API_KEY
npx wrangler secret put KAPSO_WEBHOOK_SECRET
npx wrangler secret put KAPSO_NUMERO_ID
```

Los tres, o nada: con dos de tres el endpoint sigue en 503, a propósito.

### 4. Probarlo

Escríbele al número de Kapso desde tu teléfono. Debe contestarte el agente en
segundos. Si no:

```
npx wrangler tail
```

y vuelve a escribir. Lo que vas a ver:

| En el log | Qué pasó |
|---|---|
| nada, y `/whatsapp` da 503 | falta alguno de los tres secretos |
| 401 en `/whatsapp` | el secreto no es el que puso Kapso — **o el webhook quedó como `kind: meta`**, que manda la firma en otra cabecera |
| 200 y nada más | el `phone_number_id` que manda Kapso no es el de `KAPSO_NUMERO_ID` |
| `kapso rechazó el envío` | la `KAPSO_API_KEY` no sirve, o el número no está activo |

En la bandeja, esas conversaciones salen marcadas **whatsapp**.

### 5. Lo que decides tú después

- **El botón del sitio.** `pasar_a_whatsapp` sigue apuntando a
  `WHATSAPP_E164`, que hoy es tu número personal. Si lo cambias al de Kapso,
  quien toque el botón cae con el agente en vez de contigo — y de paso tu
  número deja de estar en la respuesta pública de `/contacto`. Si lo dejas
  como está, el botón te sigue llegando a ti: las dos son defendibles, pero
  son distintas.
- **La política de privacidad.** `../privacy.html` describe el chat del sitio.
  Con este canal se guardan además conversaciones que llegan por WhatsApp
  (el texto y el id de charla de Kapso; **el teléfono no se guarda**). Eso
  toca decirlo ahí antes de que el número sea público.

### Lo que el agente puede hacer aquí, y por qué son menos cosas

En el sitio tiene seis herramientas; aquí tiene **dos**.

Las tres de enseñar —`cambiar_piel`, `componer_pagina`, `mostrar_trabajo`—
pintan algo en la pantalla de quien escribe, y en WhatsApp no hay pantalla
nuestra. Dárselas sería peor que no dárselas: las llamaría, no pasaría nada, y
prometería algo que la persona nunca ve. `pasar_a_whatsapp` tampoco tiene
sentido cuando ya estás en WhatsApp.

Quedan `avisar_a_daniel` —la misma escalada, sin el botón— y
`agendar_llamada`, que aquí manda la liga escrita en el mensaje.

Quién es el agente y qué no hace es **el mismo texto** en los dos canales: una
guía de conducta que cambia según por dónde entres es justo el hueco por el que
se cuela quien la está probando. Lo único que cambia es lo que puede hacer.

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
