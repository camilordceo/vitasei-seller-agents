# ADR-0083: Un extractor manda — el resultado de la llamada genera la orden

- **Estado:** Aceptada
- **Fecha:** 2026-07-23
- **Sprint:** —

## Contexto

Las llamadas con IA (docs/25, ADR-0060..0063) ya funcionaban: se colocaban, se grababan, se
transcribían y sus datos quedaban en `voice_calls.extracted` como `{identifier: valor}`.

Con las primeras llamadas reales apareció el hueco: **hubo llamadas que avanzaron y cerraron
compra, y no había cómo enterarse.** Los datos estaban ahí —nombre, dirección, producto— pero:

1. Había que abrir el detalle de cada llamada, una por una, para descubrir cuál terminó en venta.
2. Esa venta **no existía para el resto del sistema**: no había orden, no llegaba el aviso al
   dueño por WhatsApp, no aparecía en Órdenes ni sumaba en Reportes ni en el ROAS. Una venta por
   teléfono valía menos que una por chat solo por el canal.
3. Los seguimientos (retargets, reactivaciones y las llamadas siguientes) seguían corriendo
   sobre alguien que ya había comprado.

En WhatsApp esto lo resuelve un tag del modelo (`#orden-lista`, con la red de seguridad de
ADR-0031/0039). En una llamada no hay tags: hay **Information Extractors** de Synthflow, que ya
son configurables por agente (ADR-0062).

## Decisión

**1. Un extractor puede marcarse como "resultado de la llamada".** En la ficha del agente,
cualquier extractor —típicamente uno `SINGLE_CHOICE` llamado `resultado_llamada` con opciones
*compra / no interesada / volver a llamar / no contesta*— se marca como resultado. Solo puede
haber uno: si se marcan varios, gana el primero (dos resultados serían dos verdades).

**2. El operador define qué opciones significan COMPRA** (`saleValues`). Cuando la llamada
termina en una de ellas, se genera la orden con el resto de datos extraídos, se avisa al dueño
por WhatsApp y se cancelan seguimientos, reactivaciones y llamadas pendientes — exactamente el
mismo desenlace de una venta por chat.

**3. La comparación es EXACTA** (normalizada: sin tildes, minúsculas, sin puntuación final).
Nada de `includes`: con contención, un resultado `"no compra"` dispararía una venta porque
contiene la palabra `compra`. Aquí un falso positivo despacha mercancía que nadie pidió.

**4. Cada extractor puede declarar a qué campo de la orden va** (nombre, dirección, ciudad,
teléfono, producto, cantidad, método de pago, notas). Sin declararlo, se deduce del nombre del
extractor (`direccion_entrega` → dirección). **Lo que no mapea no se pierde: cae en las notas.**

**5. El SKU no se inventa.** El producto dicho por teléfono se busca contra el catálogo del
agente por nombre; si no hay coincidencia clara, la orden se crea **sin ítem** y el producto
dicho queda en las notas. Una orden sin SKU es honesta; una con el SKU equivocado es un
despacho equivocado.

**6. El resultado se guarda SIEMPRE** en `voice_calls.outcome`, sea venta o no, y la orden
generada en `voice_calls.order_id`. Esa es la columna que faltaba: la lista de Llamadas ahora
dice en qué terminó cada una sin abrirla, y hay un KPI de **Compras**.

**7. El método de pago se homologa contra los métodos del agente** (ADR-0055): si lo que dijo
el cliente no casa con ninguno, la orden queda `undecided` y se ve, en vez de inventar un
método que después descuadra el reporte por método.

## Consecuencias

**Lo bueno**

- Una venta por teléfono se ve, se cobra y se despacha igual que una por WhatsApp: misma tabla,
  mismo aviso, mismos reportes. El negocio no termina con dos contabilidades.
- Se puede medir la **tasa de conversión de las llamadas** (compras / contestadas), que es lo
  que decide si la feature se queda.
- El resultado sirve aunque no sea venta: *no interesada* y *volver a llamar* son insumo para
  la siguiente campaña.
- Nada cambia para quien no configure el extractor de resultado: las llamadas siguen igual que
  hoy (la UI avisa en ámbar que ninguna venta se registrará sola).

**Lo malo / lo que queda atado**

- **La orden depende de que el modelo de voz clasifique bien.** Un cliente ambiguo y una IA
  optimista pueden crear una orden que después toca cancelar. Se mitiga con la comparación
  exacta y con que la orden nace en `pending_handoff` (nadie despacha sin revisar).
- Los datos de una llamada son peores que los de un chat: el cliente dicta una dirección y la
  transcripción puede equivocarse en un número. Por eso el aviso al dueño incluye todo lo
  capturado y la orden queda con la transcripción a un clic.
- Cambiar el nombre del extractor de resultado en Synthflow rompe el vínculo (el dato se busca
  por identifier). Es el mismo contrato que ya tenían los extractores.

## Alternativas consideradas

- **Un segundo modelo que lea el transcript y decida si hubo venta.** Descartado: agrega una
  llamada de IA, latencia y costo por cada llamada, para reemplazar un dato que el propio
  assistant ya sabe emitir. Contradice además el principio del proyecto de una sola llamada.
- **Frases fijas en el transcript** ("queda confirmado…") como la red de seguridad de WhatsApp
  (ADR-0031). Descartado: un transcript hablado es mucho más ruidoso que un mensaje escrito y
  esas reglas ya dan falsos positivos en texto.
- **Que cualquier extractor con valor genere la orden.** Descartado: una llamada donde el
  cliente da su nombre y cuelga no es una venta.
- **Marcar el resultado por convención de nombre** (`identifier === "resultado_llamada"`).
  Descartado: obliga a todos los agentes a llamar igual a su extractor y no deja definir qué
  opciones son compra — que es exactamente lo que cambia entre mercados.
