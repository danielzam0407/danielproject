# Privacidad — nerv

Qué hace nerv con tus datos: qué guarda el chat, quién puede verlo y cómo
pedir que se borre.

Actualizada el 26 de agosto de 2026

Versión corta: éste es el sitio de un estudio de una persona. No tiene
analítica y no pone cookies. Si nunca usas el chat, lo único que ocurre es que
carga una página web y el sitio recuerda qué idioma elegiste. Si usas el chat,
la conversación se guarda — eso está más abajo.

## Qué se carga al abrir la página

Las tipografías vienen de Google Fonts. En la portada, además, una hoja de
estilo viene de unpkg. Cargar un archivo del servidor de alguien más significa
que ese servidor ve tu dirección IP — así funciona la web, y vale para
cualquier sitio que use un CDN de tipografías. Aquí ninguno de los dos se usa
para identificarte.

La página la sirve Cloudflare Pages, y el chat corre sobre Cloudflare Workers
con su base de datos. Cloudflare guarda sus propios registros de servidor y
actúa como proveedor de Daniel, no por cuenta propia.

El sitio sí recuerda un par de cosas pequeñas en tu navegador para comportarse
como lo dejaste: el idioma que elegiste y —en cuanto escribes en el chat— el id
de tu conversación y cualquier cambio de apariencia que le hayas pedido al
agente. El idioma y la apariencia nunca salen de tu dispositivo. El id de la
conversación sí: tu navegador lo manda de vuelta con cada mensaje, y es así como
el agente retoma el hilo donde lo dejaste.

## Si usas el chat

El chat manda lo que escribes a un servidor pequeño que opera Daniel, y ese
servidor se lo pasa a **DeepSeek**, la empresa cuyo modelo escribe las
respuestas. Tu mensaje y la conversación hasta ahí se procesan allá para que
pueda volver una respuesta.

- **La conversación se guarda.** Tus mensajes y las respuestas del agente
  quedan en una base de datos que Daniel opera sobre Cloudflare, para que el
  hilo sobreviva a una recarga y para que él pueda leer qué pediste. Es la
  única persona que puede abrirla.
- **Tu dirección IP se registra en dos lugares.** Uno es un contador por día,
  para que una sola persona no dispare la cuenta; ése se borra solo a las 48
  horas. El otro va en la conversación misma, para poder rastrear una sesión
  abusiva, y dura lo que dure la conversación.
- **Hoy las conversaciones no caducan solas.** Se quedan hasta que Daniel las
  borra. Pedirle que borre la tuya es un mensaje — está más abajo.

## Si pides que te pongan en contacto

Cuando la conversación se vuelve contacto —agendar una llamada, abrir WhatsApp
o dejar un recado— a Daniel le llega un aviso por Telegram con lo que pediste y
los últimos turnos de la conversación, para poder contestarte bien. Si dejas
nombre y correo, también le llegan, y quedan guardados en la misma base que la
conversación.

Lo guarda como cualquiera guarda el correo de un cliente potencial. No se
vende, no se comparte y no se mete a ningún sistema de publicidad.

Agendar una hora usa la propia página de reservas de Google Calendar, que se
rige por el aviso de privacidad de Google y no por éste.

## Acceso al calendario

Daniel usa una herramienta privada que lee y escribe *su propio* Google
Calendar para manejar su agenda. Corre en su máquina, no la usa nadie más y no
toca datos de quien visita el sitio. Se menciona aquí porque Google exige que
una app que use su API apunte a un aviso de privacidad.

## Menores

Este sitio no está dirigido a menores y no recoge nada de ellos a sabiendas.

## Pedir tus datos de vuelta

Si chateaste con el agente o le escribiste a Daniel y quieres que eso se borre,
pídeselo y lo borra — la conversación, el aviso que produjo y cualquier cosa
que hayas dejado con ella.

Escribe a dani@nervcenter.online, o usa https://nervcenter.online/contact o el
propio chat. Di qué quieres que se borre y se borra.

## Cambios

Si esto cambia, la fecha de arriba cambia con ello.
