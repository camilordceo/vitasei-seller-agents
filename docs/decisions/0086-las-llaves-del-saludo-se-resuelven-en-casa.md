# ADR-0086: Las llaves del saludo se resuelven en casa, y cada campaña abre a su manera

- **Estado:** Aceptada
- **Fecha:** 2026-07-23
- **Sprint:** —

## Contexto

El assistant abre las llamadas con una frase que necesita un dato:

> "Hola, soy Vanessa de Vitasei. Te llamaba porque estabas interesado en **{producto}**,
> ¿tienes un minuto?"

Cuando la llamada nace de una conversación de WhatsApp, `{producto}` sale de la conversación.
En una **campaña** no hay conversación: es un número frío de un archivo. La única forma de
llenarlo era que el Excel trajera una columna llamada exactamente `producto` — y nada en la
pantalla lo decía. Si no venía, la llamada salía igual y la frase quedaba coja.

Y hay una pregunta que la documentación de Synthflow **no contesta**: sus variables
(`custom_variables`) se referencian con llaves, sí, pero su doc lo promete para el *prompt* y no
dice nada del *saludo*. Además su propia doc se contradice con la realidad ya verificada contra
la cuenta (docs/25 §2.3): el `custom_variables` de `POST /v2/calls` es un **array** de
`{key,value}`, no el objeto que muestran. Apostar a que reemplazan bien en el saludo tiene un
costo asimétrico: si no lo hacen, **el bot lee la llave en voz alta**. Eso no se descubre en una
prueba; se descubre cuando ya llamaste a 300 personas.

## Decisión

**1. Las llaves las resolvemos nosotros, antes de llamar.** El saludo y el prompt ya viajan por
llamada (ADR-0060), así que salen de aquí **ya resueltos**. `lib/agent/voiceTemplate.ts` es puro
y hace tres cosas: encontrar las variables de un texto, decir cuáles faltan y reemplazarlas.
`custom_variables` se sigue enviando —el assistant puede referenciarlas en **su** propio prompt,
el que vive en el panel y no viaja— pero ya no dependemos de eso.

**2. Los nombres se canonizan de los dos lados.** La columna "Producto Interesado" del Excel y
el `{producto interesado}` que alguien escribió en el saludo son la **misma** variable: sin
tildes, minúsculas y `_`. Una sola función (`normalizeVariableKey`) la usan el lector del
archivo y el renderizador; si se separaran, la variable no se llenaría y nadie sabría por qué.

**3. Cada campaña puede abrir a su manera.** `voice_campaigns` gana `greeting` (el saludo de esa
campaña, con llaves) y `variables` (valores fijos para toda la lista, `producto = Colágeno`,
para no repetir una columna en 500 filas). Precedencia, de lo específico a lo general:
**fila del archivo > valores fijos de la campaña > lo que aporte la conversación**. Vacío = el
saludo del agente, como antes.

**4. No se lanza una campaña que va a decir una frase a medias.** El preview del archivo devuelve
qué variables trae y **en cuántas filas**; el formulario muestra el saludo **ya resuelto con la
primera fila real**, marca cuáles faltan y deshabilita "Lanzar". El servidor **vuelve a validar**
al crear —el navegador no es autoridad— y rechaza con el detalle: `{producto} falta en 12 de 300`.

**5. Si algo se escapa, se borra la llave, no se lee.** En tiempo de llamada, una variable sin
valor se reemplaza por vacío y se limpian los espacios y la puntuación huérfana. Entre una frase
corta y un bot diciendo "llave producto", gana la frase corta. Es una red de seguridad, no el
camino: para llegar ahí hay que haber pasado dos validaciones.

## Consecuencias

**Lo bueno**

- Lo que la pantalla muestra es lo que la persona va a oír, antes de gastar una sola llamada.
- Una lista de colágeno y una de magnesio ya no necesitan dos assistants ni editar el saludo del
  agente entre campañas.
- Dejamos de depender de un comportamiento no documentado de un tercero en la primera frase de
  la llamada.

**Lo malo / lo que hay que saber**

- Requiere la migración **0033**. Sin aplicarla, una campaña con saludo propio o variables fijas
  se rechaza al crearla con ese mensaje exacto (no se crea a medias y en silencio).
- El saludo configurado **en el panel de Synthflow** sigue fuera de nuestro alcance: si el
  agente no tiene saludo aquí y la campaña tampoco, manda el del assistant y sus llaves las
  resuelve (o no) Synthflow. La ficha del agente empuja a poner el saludo aquí.
- Las variables se recortan a 200 caracteres y los identificadores a 60: son nombres y
  productos, no párrafos.

## Alternativas consideradas

- **Dejar que Synthflow reemplace.** Es menos código y lo que la doc insinúa, pero el modo de
  fallo es el peor posible (la llave leída en voz alta) y solo se ve en producción.
- **Exigir que el archivo traiga siempre la columna.** Obliga a repetir el mismo valor en 500
  filas y no resuelve el saludo del agente, que también tiene llaves.
- **Un assistant de Synthflow por campaña.** Multiplica los assistants que hay que mantener y
  reintroduce justo lo que ADR-0085 vino a evitar: tocarlos.
