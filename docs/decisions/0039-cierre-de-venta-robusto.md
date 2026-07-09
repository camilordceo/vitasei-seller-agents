# ADR-0039: Cierre de venta robusto (crear orden + avisar sin depender de una frase)

- **Estado:** Aceptada
- **Fecha:** 2026-07-08
- **Sprint:** 6 (continuación — órdenes)

## Contexto
El agente cierra la venta emitiendo `#orden-lista` (→ crea orden + handoff + aviso al dueño). La
red de seguridad de **ADR-0031** cubría el caso en que el modelo cierra pero olvida `#orden-lista`
y solo emite `#compra-contra-entrega`/`#addi`: se infería la orden **si** el texto matcheaba una
lista **muy estrecha** de frases (`isPurchaseConfirmation`) Y el método estaba decidido.

En producción esa heurística se quedó corta: llegó un cierre con `#compra-contra-entrega` cuyo texto
no matcheaba ninguna frase → **no se creó la orden ni se avisó** al dueño. Depender de la redacción
exacta del modelo es frágil.

## Decisión
Ampliar la inferencia del cierre y gatearla por **datos reales** en vez de por la redacción:

- **Señal de cierre (inferido)** = método decidido (`cod`/`addi`, de este turno o previo) **y**
  (se acaba de elegir el método —`#compra-contra-entrega`/`#addi` en este turno— **o** el texto es
  una confirmación). Es decir, elegir el método ahora ya cuenta como señal (no hace falta la frase).
- **Gate de datos** (`hasOrderData`): una orden **inferida** solo se crea si la extracción trae
  datos reales (ítems **o** algún dato de envío). Así, elegir el método **antes** de recolectar
  datos NO crea una orden vacía; cuando lleguen los datos (o `#orden-lista`) se crea. `#orden-lista`
  (explícito) **ignora** el gate.
- Se **amplían** además las frases de `isPurchaseConfirmation` (registrado/listo/"confirmo tu
  pedido"), ya sin riesgo de falsos positivos porque el gate de datos las respalda.
- Nuevo evento `order_inferred_skipped` (método elegido sin datos aún) para trazabilidad.
- **No** fuerza handoff en el caso inferido (igual que ADR-0031): solo crea la orden + avisa.

## Consecuencias
- **Bueno:** los cierres con `#compra-contra-entrega`/`#addi` crean la orden + avisan de forma
  confiable (no dependen de una frase); no se crean órdenes vacías (gate de datos); trazabilidad del
  "se intentó pero faltaban datos". Lógica pura testeada (`hasOrderData`, frases ampliadas).
- **Malo / atado a futuro:**
  - Corre la extracción (1 completion) en los turnos con tag de método aunque no se cree la orden;
    aceptable al volumen actual.
  - Residual: si el modelo cierra sin NINGÚN tag ni frase de confirmación, no se infiere (lo cubre
    el dashboard/manual). La configurabilidad de los hashtags (para otros mercados) va aparte.

## Alternativas consideradas
- **(a) Crear la orden apenas se emite `#compra-contra-entrega`** (sin gate): crearía órdenes vacías
  al elegir el método antes de dar datos, y como la creación es idempotente no se completarían luego.
  Descartada.
- **(b) Solo ampliar las frases** de `isPurchaseConfirmation`: sigue dependiendo de la redacción del
  modelo; frágil. Se hace además, pero no como mecanismo principal.
- **(c) Correr la extracción en cada respuesta** con método decidido: más robusto pero más costo;
  se acota a turnos con tag de método o confirmación.
