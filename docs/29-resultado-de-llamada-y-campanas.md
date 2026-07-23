# 29 — Resultado de la llamada (→ orden) y campañas de llamadas masivas

> **Estado:** implementado, pendiente de aplicar la migración `0032`.
> ADRs: [0083](decisions/0083-el-resultado-de-la-llamada-genera-la-orden.md) ·
> [0084](decisions/0084-campanas-de-llamadas-masivas-con-ritmo.md).
> Base: [docs/25 — Llamadas con IA (Synthflow)](25-llamadas-con-ia-synthflow.md).

Las llamadas con IA ya sonaban, grababan y extraían datos. Faltaban las dos cosas que las
vuelven un canal de ventas: **enterarse de las ventas** y **poder llamar una lista**.

---

## 1. El resultado de la llamada genera la orden

### 1.1 Qué se configura (ficha del agente → *Llamadas con IA* → *Datos a extraer*)

| Campo | Qué hace |
|---|---|
| **Es el resultado de la llamada** | Marca ese extractor como el que dice en qué terminó. **Solo uno** por agente. |
| **Opciones que significan COMPRA** | Lista separada por coma (`compra`). Al caer en una de ellas se genera la orden. |
| **Campo de la orden** | A qué campo va cada otro dato: nombre, dirección, ciudad, teléfono, producto, cantidad, método de pago, notas. `Automático` lo deduce del nombre del extractor. |

El botón **"Agregar extractor de resultado"** crea el estándar de una sola vez:

```
identificador: resultado_llamada     (Opción única)
opciones:      compra, no interesada, volver a llamar, no contesta
compra =       compra
```

> Si ningún extractor está marcado como resultado, la ficha lo dice en ámbar: las llamadas se
> siguen grabando y transcribiendo, pero **ninguna venta se registra sola**.

### 1.2 Qué pasa cuando el resultado es "compra"

1. Se arma la orden con los datos extraídos (nombre, dirección, ciudad, producto, cantidad).
2. El **método de pago** se homologa contra los métodos del agente (ADR-0055). Sin coincidencia
   queda `Sin definir` — no se inventa.
3. El **producto** se busca en el catálogo del agente por nombre. Si no hay coincidencia clara,
   la orden se crea **sin ítem** y el producto dicho queda en las notas.
4. La orden nace en `pending_handoff`, en la moneda del agente (ADR-0068).
5. **Aviso al dueño por WhatsApp**, igual que una venta por chat, con la coletilla
   `Origen: llamada con IA (compra)`.
6. Se cancelan seguimientos, reactivaciones y llamadas programadas de esa conversación.
7. La nota de la llamada en el hilo dice el resultado y que se generó la orden.

**La comparación del resultado es exacta** (sin tildes, minúsculas): `"no compra"` **no** es una
venta. Ver ADR-0083.

### 1.3 Dónde se ve

- **Llamadas → Llamadas con IA**: cada fila muestra el resultado; si hubo venta, un chip verde
  *"compra · orden creada"* que lleva a Órdenes filtrado por ese cliente.
- **KPI "Compras"** arriba, con el % sobre las contestadas.
- **Órdenes** y **Reportes**: la venta entra por el mismo camino que las de WhatsApp.

---

## 2. Campañas de llamadas masivas

### 2.1 Cómo se lanza (Llamadas → **Campañas**)

1. Elegir **agente** (aporta voz, prompt de llamada, extractores y horario).
2. **Nombre**, **cada cuántos minutos** sale una llamada (default 2) e **indicativo del país**
   (para los números escritos en local).
3. **Objetivo de la llamada**: se suma al prompt de voz en cada llamada de la campaña.
4. **Empezar**: vacío = ya; o una fecha/hora.
5. Subir el **archivo** → el sistema muestra **cuántos números entendió**, una muestra, los
   repetidos, las filas que no sirvieron (con línea y motivo) y **cuánto va a durar**.
6. **Lanzar**.

### 2.2 El archivo

- **CSV** (coma, punto y coma, tab o `|`; comillas soportadas; UTF-8 o Latin-1) o **Excel
  `.xlsx`**. El `.xls` viejo no se lee: guardar como `.xlsx` o CSV.
- Encabezados reconocidos: `telefono/teléfono/phone/celular/movil/numero/whatsapp/tel` y
  `nombre/name/cliente`. **Sin encabezado** se adivina la columna con pinta de teléfonos.
- **Las demás columnas viajan como variables** de la llamada y se pueden referenciar en el
  prompt de voz con `{llaves}`.
- Teléfonos: 10 dígitos o menos → se les antepone el indicativo; de 11 en adelante se toman como
  internacionales. Tope de **5.000** números por campaña y **1 MB** por archivo.

> **Notación científica (la trampa de Excel).** Un teléfono guardado como número se exporta como
> `5.732181974E+11`. En un `.xlsx` el lector lo **expande al valor exacto** (`573218197400`)
> antes de tocarlo — sin eso, al quitar los símbolos quedaba `573218197411`: un número real, de
> otra persona. En un **CSV** el archivo ya trae el valor *mostrado*: si viene recortado
> (`5,73218E+11`, 6 dígitos significativos) la fila se **rechaza** con el motivo, porque los
> dígitos que faltan no se pueden adivinar. Solución: formato de **texto** en la columna de
> teléfonos antes de exportar.

```csv
nombre;telefono;producto
Ana Pérez;3001112233;Colágeno
Luis;+57 300 999 8877;Magnesio
```

### 2.3 El ritmo (lo importante)

- Cada fila se agenda en `inicio + i × intervalo`, **y además** el worker no coloca la siguiente
  hasta que pasó el intervalo desde la anterior *realmente colocada*.
- Por eso una campaña atrasada (cron caído, campaña pausada) **drena a su ritmo** en vez de
  disparar la cola de golpe.
- El cron corre **cada minuto** → precisión de ~1 minuto.
- Aplican las guardas de siempre: país habilitado y **horario del agente** (fuera de horario se
  difiere, no se cancela).

### 2.4 Guardas propias del llamado en frío

- No se agenda un número con una llamada **viva** (programada o en curso).
- No se llama a quien **ya compró** (cualquier orden no cancelada de ese teléfono).
- El archivo se **deduplica**.

### 2.5 Control

**Pausar** (detiene sin tocar la cola) · **Reanudar** · **Cancelar** (tumba las pendientes, con
confirmación) · **Ver llamadas** (la lista filtrada por esa campaña). Una campaña sin pendientes
se marca *Terminada* sola.

### 2.6 El saludo de la campaña y sus variables (ADR-0086)

El assistant abre así:

> "Hola, soy Vanessa de Vitasei. Te llamaba porque estabas interesado en **{producto}**,
> ¿tienes un minuto?"

En una llamada de WhatsApp `{producto}` lo pone la conversación. En una campaña **no hay
conversación**, así que el dato sale del archivo o de la campaña:

| Dónde | Qué es | Ejemplo |
|---|---|---|
| **Saludo con el que abre** | El saludo de ESTA campaña, con llaves. Vacío = el del agente. | `…estabas interesado en {producto}, ¿tienes un minuto?` |
| **Valores fijos** | Un valor para toda la lista, para no repetir una columna 500 veces. | `producto = Colágeno hidrolizado` |
| **Columnas del archivo** | Una variable por columna extra, por persona. | columna `producto` |

**Precedencia:** columna del archivo → valor fijo de la campaña → lo que aporte la conversación.
Lo más específico gana. `{nombre}` sale de la columna de nombres.

Los nombres se comparan **sin tildes, en minúsculas y con `_`**: la columna "Producto
Interesado" llena `{producto interesado}` y `{producto_interesado}` por igual.

**Las llaves las resolvemos nosotros antes de llamar**, no Synthflow: su documentación solo
promete variables en el prompt, y si nadie reemplaza, el bot **lee la llave en voz alta**. El
`custom_variables` se envía igual, por si el assistant las usa en su propio prompt.

**Nada sale a medias.** Al subir el archivo, la pantalla muestra qué variables trae y en cuántas
filas, **el saludo ya resuelto con la primera fila real**, y bloquea "Lanzar" si alguna variable
del texto no está llena en todas. El servidor lo vuelve a validar al crear y rechaza diciendo
`{producto} falta en 12 de 300`.

### 2.7 Un número frío no crea conversación

La conversación (y el contacto) **solo se crean si hay venta**, con `source = 'voice'`. Cien
conversaciones vacías inflarían los chats de Reportes y el ROAS. El registro de una llamada sin
venta vive completo en la sección **Llamadas** (resultado, grabación, transcripción).

---

## 3. Modelo de datos (migración `0032_voice_outcome_and_campaigns.sql`)

**`voice_calls` — columnas nuevas**

| Columna | Para qué |
|---|---|
| `outcome` | Resultado crudo (`compra`, `no interesada`…). Se guarda siempre. |
| `order_id` | Orden generada por la llamada. NULL = no hubo venta. |
| `campaign_id` | Campaña que la originó. NULL = llamada de una conversación. |
| `contact_name` | Nombre que venía en el archivo (Synthflow lo exige al llamar). |
| `variables` | Columnas extra del archivo → `custom_variables`. |

`conversation_id` y `contact_id` pasan a ser **opcionales**; `trigger` acepta `campaign`;
`conversations.source` acepta `voice`.

**`voice_campaigns` — tabla nueva**

`id`, `agent_id`, `name`, `status` (`running · paused · completed · cancelled`),
`interval_minutes`, `guidance`, `source_filename`, `total`, `starts_at`, `finished_at`,
`created_at`, `updated_at`.

**Migración `0033_voice_campaign_greeting_variables.sql`** (ADR-0086) le suma dos columnas:
`greeting` (saludo propio de la campaña, con `{llaves}`) y `variables` (valores fijos para toda
la lista). Sin aplicarla, una campaña con saludo propio o valores fijos **se rechaza al crearla**
con ese mensaje; las campañas normales siguen funcionando igual.

---

## 4. Puesta en marcha

1. Aplicar `supabase/migrations/0032_voice_outcome_and_campaigns.sql` y
   `0033_voice_campaign_greeting_variables.sql`.
2. En la ficha del agente: **Agregar extractor de resultado** → **Guardar y actualizar
   Synthflow** (esta vez sí: es la única forma de que Synthflow conozca el extractor). Los demás
   cambios del día a día van con **Guardar solo aquí**. Ver §5.
3. Verificar que el agente tenga `voice_enabled`, assistant, número saliente y horario.
4. Llamadas → **Campañas** → subir el archivo, escribir el saludo, revisar y lanzar.

> Recordatorio: `VOICE_CALLS_ENABLED` sigue siendo el kill switch global. Con él apagado no sale
> ninguna llamada, ni de cadencia ni de campaña.

---

## 5. Guardar sin tocar Synthflow (ADR-0085)

Actualizar un assistant lo pasa a una **versión nueva** y, en la práctica, le cambia la voz —a
peor—. Antes eso pasaba en cada guardado de la ficha, porque el guardado empujaba los
extractores. Ya no: **guardar y sincronizar son dos botones distintos.**

| Botón | Qué hace | Cuándo |
|---|---|---|
| **Guardar solo aquí** | Escribe en la base. **No llama a Synthflow.** | Siempre: cadencia, prompt, saludo, países, mapeo a la orden, prender/apagar. |
| **Guardar y actualizar Synthflow** | Además crea/actualiza los extractores y los adjunta al assistant. Pide confirmación. | Solo cuando cambiaste **los datos a extraer** y quieres que Synthflow los conozca. |
| **Traer de Synthflow** | **Solo lectura**: llena el formulario con los extractores que ya existen en el assistant. No modifica nada allá. | Cuando el extractor se creó en el panel de Synthflow y lo quieres acá. |

Detalles que importan:

- **Traer no guarda.** Cae en el formulario para que lo revises; después eliges con cuál botón
  guardas.
- **Traer no borra lo nuestro.** El extractor marcado como *resultado de la llamada*, los valores
  que significan compra y el campo de la orden **no existen en Synthflow**: se conservan del
  extractor local con el mismo identificador.
- Un extractor guardado aquí y **no** empujado no extrae nada en la llamada. Es el precio de no
  tocar el assistant sin permiso, y la sección lo dice en pantalla.
- Queda rastro en `events_log`: `voice_config_updated` con `syncedToSynthflow`, y
  `voice_extractors_imported` al traer.
