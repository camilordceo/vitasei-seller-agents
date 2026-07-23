# ADR-0085: Guardar sin tocar Synthflow, y traer en vez de empujar

- **Estado:** Aceptada
- **Fecha:** 2026-07-23
- **Sprint:** —

## Contexto

La ficha del agente guarda la config de llamadas (cadencia, prompt de voz, saludo, países,
extractores) en Supabase **y**, en el mismo botón, empujaba los extractores a Synthflow: crear o
actualizar cada acción (`POST`/`PUT /v2/actions`) y volver a adjuntarlas al assistant
(`POST /v2/actions/attach`).

Ese empujón no es gratis: **toca al assistant**. Al hacerlo, Synthflow lo pasa a una versión
nueva y —reportado desde la operación, con llamadas reales— **la voz cambia y suena peor**. La
API le da la razón al reporte: el assistant tiene parámetros de voz que el `GET` no devuelve
(`voice_stability`, `voice_similarity_boost`, `voice_style`, `voice_speed`), y su changelog
describe un "language-aware synthesizer" que actualiza el sintetizador solo. Nuestro
read-modify-write puede reenviar sin ellos y dejarlos en el default. El mismo módulo ya carga la
cicatriz: `syncAssistantWebhook` verifica después de cada `PUT` que no le haya borrado el
prompt, la voz o el saludo, porque una vez lo hizo.

El resultado práctico era absurdo: cambiar "una llamada a los 10 minutos" por "a los 15", o
corregir un typo en el prompt, costaba la calidad de la voz del agente. Y no había forma de
hacer lo contrario —el operador crea un extractor **en el panel de Synthflow** y lo quiere aquí—
salvo transcribirlo a mano campo por campo.

## Decisión

**1. Guardar NO habla con Synthflow.** `saveVoiceConfig` recibe `syncSynthflow` y su default es
`false`: escribe en Supabase y termina. La ficha muestra dos botones:

- **Guardar solo aquí** (primario): los datos quedan en la base. El assistant no se entera.
- **Guardar y actualizar Synthflow** (secundario, con paso de confirmación): además empuja los
  extractores. Es lo único que lo hace, y la pantalla dice qué implica.

Queda al lado de los otros dos empujones, que ya eran explícitos desde ADR-0060: sincronizar la
voz y apuntar el webhook. La regla queda pareja: **a Synthflow se le escribe solo cuando alguien
pulsa el botón que lo dice.**

**2. Traer también es un botón: "Traer de Synthflow".** Lee `GET /v2/assistants/{model_id}?
include_actions=true` para los `action_id` adjuntos y luego `GET /v2/actions/{id}` de cada uno,
y **llena el formulario** con los extractores que ya existen allá. Es solo lectura: no crea, no
adjunta y no modifica al assistant, así que no le cambia la versión ni la voz.

**3. Lo traído NO se guarda solo.** Cae en el formulario y el operador decide con cuál de los
dos botones lo guarda. Además, lo que es **nuestro y no existe en Synthflow** —qué extractor es
el *resultado de la llamada*, qué valores significan compra y a qué campo de la orden va cada
dato (ADR-0083)— se conserva del extractor local con el mismo identificador. Traer nunca borra
el mapeo a la orden.

**4. Queda en el rastro.** `events_log` guarda `voice_config_updated` con
`syncedToSynthflow: true|false`, y `voice_extractors_imported` cuando se trae. Si un día la voz
vuelve a cambiar sola, el log dice si salió de aquí.

## Consecuencias

**Lo bueno**

- El caso normal —ajustar cadencia, prompt, países, saludo, el mapeo a la orden— ya no puede
  degradar la voz. Es la operación diaria y ahora es inofensiva.
- El extractor se escribe **una vez**, en el lado que sea, y se sincroniza en la dirección que
  haga falta.
- Un Synthflow caído deja de ser un problema para guardar: el guardado normal ni lo llama.

**Lo malo / lo que hay que saber**

- Los extractores pueden quedar **desalineados**: guardados aquí y sin empujar allá. Es
  deliberado —esa es la palanca— pero significa que un extractor nuevo no extrae nada hasta que
  alguien pulse el botón de actualizar. La ficha lo dice en el texto de la sección.
- El empujón sigue costando una versión del assistant. No lo arreglamos: lo hacemos raro,
  explícito y confirmado.

## Alternativas consideradas

- **Empujar solo si los extractores cambiaron** (diff contra lo guardado). Reduce la frecuencia,
  pero deja la decisión en un heurístico: el día que el diff se equivoque, la voz vuelve a
  cambiar sin que nadie lo haya pedido. El operador sabe cuándo quiere sincronizar; el código no.
- **Nunca empujar y configurar los extractores a mano en el panel.** Descarta la mitad de la
  feature (ADR-0062) y obliga a escribir dos veces lo mismo.
- **Reenviar los parámetros de voz en cada `PUT`** para que no se pierdan. No se puede sostener:
  no vienen todos en el `GET`, y el problema —la versión nueva— no depende de qué campos
  mandemos.
