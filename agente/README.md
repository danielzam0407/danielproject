# agente

El chat del portfolio. Atiende a quien llega, contesta lo que sabe, y cuando la
conversación vale la pena la convierte en una llamada agendada o en un WhatsApp
que la persona sólo tiene que enviar.

## Por qué existe este directorio

El portfolio es estático — GitHub Pages sirve archivos, no ejecuta código. Un
agente necesita servidor porque **la llave de la API no puede vivir en el
navegador**: cualquiera abre DevTools, la copia, y gasta con tu cuenta.

Así que el sitio se queda en Pages y esto vive en un Cloudflare Worker. El
navegador le habla al worker, y sólo el worker conoce la llave.

```
navegador ──POST──▶ worker ──▶ API de DeepSeek (formato Anthropic)
   ▲                  │
   └──── SSE ─────────┘   (texto en streaming + los botones de acción)
```

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

Carga los tres secretos. Cada comando pide el valor y no queda en el repo:

```bash
npx wrangler secret put DEEPSEEK_API_KEY
```

```bash
npx wrangler secret put WHATSAPP_E164
```

```bash
npx wrangler secret put CAL_URL
```

`WHATSAPP_E164` va en formato internacional **sin `+` y sin espacios** —
`528112345678`. `CAL_URL` es la página completa, por ejemplo
`https://calendar.app.google/...`.

```bash
npm run deploy
```

Wrangler imprime la URL del worker. Cópiala.

## Conectarlo al sitio

En `../index.html`, hasta abajo, hay una línea que hoy está vacía:

```js
var ENDPOINT = '';
```

Pon ahí la URL del worker. **Mientras esté vacía el botón no se dibuja** — el
sitio nunca muestra un chat roto, simplemente no hay chat.

## Llenar el perfil

`src/persona.js` empieza con un bloque `PERFIL`. Ahí está lo que el agente da
por cierto sobre ti, y lo va a repetir a desconocidos. Cualquier cambio
necesita `npm run deploy` otra vez.

## Lo que cuesta

Corre con `deepseek-v4-flash` vía el endpoint Anthropic-compatible de DeepSeek
(`https://api.deepseek.com/anthropic`). En una conversación de portfolio cada
mensaje ronda **~0.08 ¢ USD** off-peak (unos 2.000 tokens de entrada y 500 de
salida); en peak UTC el doble.

Los topes están en `src/index.js`:

| Constante | Valor | Qué frena |
| --- | --- | --- |
| `TOPE_POR_IP` | 40 / día | Que una persona se quede pegada al chat |
| `TOPE_GLOBAL` | 800 / día | Tu gasto total, pase lo que pase |

Con esos números el peor día posible son **unos 0.60–1.20 USD**, no ~18.

## Ver qué está pasando

```bash
npm run logs
```

Muestra las peticiones en vivo. Los errores del agente se escriben ahí con
`console.error` — el visitante sólo ve un mensaje genérico, nunca el detalle.

## Cómo está armado

| Archivo | Qué es |
| --- | --- |
| `src/persona.js` | Perfil, tono y las dos herramientas. **Es el que vas a editar.** |
| `src/index.js` | Plomería: CORS, topes, el loop de herramientas y el streaming |
| `wrangler.toml` | Nombre del worker, orígenes permitidos y el almacén de cuotas |

El widget del navegador no está aquí: vive al final de `../index.html`, fuera
del bloque `<x-dc>`, para que una sincronización desde Claude Design no se lo
lleve por delante.

### Decisiones que no son obvias

- **El navegador manda `{rol, texto}`, nunca bloques de contenido crudos.** Si
  aceptáramos lo que el cliente mande tal cual, cualquiera podría inyectar un
  `tool_result` falso y hacer que el agente afirme lo que se le antoje. El
  worker reconstruye los mensajes desde cero.
- **El texto del modelo se pinta con `textContent`, nunca con `innerHTML`.** Lo
  que escribe el agente es texto, no marcado.
- **Las dos herramientas sólo arman una URL.** No tocan red ni estado, así que
  el loop no puede quedarse colgado esperando algo de afuera.
- **CORS lo decide el servidor.** Un origen que no esté en `ORIGENES` recibe 403
  antes de que se toque la API.
- **DeepSeek con el SDK de Anthropic.** Misma librería, `baseURL` apuntando a
  DeepSeek. Sin betas/fallbacks de Anthropic: DeepSeek no los implementa.

## Lo que este agente no hace

No manda mensajes por WhatsApp por su cuenta: eso necesita WhatsApp Business
Platform, con cuenta de Meta Business, número dedicado y verificación. Lo que
hace es preparar el mensaje y dárselo al visitante ya escrito; cuando esa
persona lo envía, a ti te llega un WhatsApp real con contexto, desde su número.
Para la mayoría de los portfolios eso es suficiente y cuesta cero.
