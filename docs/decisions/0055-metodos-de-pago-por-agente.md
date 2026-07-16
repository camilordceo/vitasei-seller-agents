# ADR-0055: Métodos de pago (tags de compra) configurables por agente

- **Estado:** Aceptada
- **Fecha:** 2026-07-15
- **Sprint:** post-v1 (multi-agente)

## Contexto
Los tags de compra estaban **cableados** en el backend e iguales para todos los agentes:
`#compra-contra-entrega` → `cod` y `#addi` → `addi`, y `fulfillment_method` era un **enum**
de Postgres `('addi','cod','undecided')`. Con multi-marca/multi-mercado, un agente de otro
país necesita sus propios métodos (p. ej. EE.UU. con **Zelle**). Si el modelo escribía
`#zelle`, el parser no lo reconocía: el tag **se colaba visible al cliente** y no fijaba método
ni generaba la orden. Lo único configurable por agente era el `system_prompt`.

## Decisión
Cada agente define sus **métodos de pago** en la sección de Agentes, guardados en el jsonb
`agents.payment_methods` = `[{ tag, label, method }]`:
- `tag`: lo que emite el modelo (`#zelle`); se normaliza (un `#`, minúsculas, `[a-z0-9-]`).
- `label`: nombre visible (aviso al dueño + reporte "por método").
- `method`: clave estable guardada en `fulfillment_method`; se deriva del tag salvo los seeds
  de Colombia, que conservan `cod`/`addi` para no partir el histórico.

El parser (`parseReply`) se vuelve *agent-aware*: recibe los métodos del agente, reconoce sus
tags (los quita del texto) y devuelve `paymentMethod`. Emitir un tag de pago = "el cliente
eligió este método" (fija `fulfillment_method` en la conversación y alimenta el cierre inferido,
igual que antes hacían `#cod`/`#addi`). Los tags **universales** `#orden-lista`/`#humano`/
`#llamada` siguen cableados. El tag **solo** marca el método y genera la orden; no envía info
extra (el link de Addi se conserva únicamente para el método `addi`, retrocompat CO).

Como los métodos dejan de ser un set fijo, `fulfillment_method` migra de **enum a texto libre**
(mismo criterio que `events_log.source`, ADR-0013). Los reportes agrupan "por método" de forma
**dinámica** (claves presentes en las órdenes + las conocidas), con etiquetas tomadas de la
config de los agentes.

## Consecuencias
- Nuevos mercados se soportan sin tocar código: se agregan métodos en el editor del agente.
- Se arregla la fuga: un tag de pago no reconocido ya no puede llegar al cliente (si está
  configurado se quita; si no, simplemente no es un tag y queda como texto normal — igual que hoy).
- `agents.payment_methods` se lee en consulta aparte y resiliente a 42703 en la ruta de inbound;
  `getAgents` reintenta sin la columna. No arriesga producción entre el deploy y la migración.
- El editor de órdenes admite el método libre de una orden aunque no esté en la lista conocida.
- Los agentes existentes (Colombia) quedan con `#compra-contra-entrega`/`#addi` (claves cod/addi)
  vía seed en la migración; su comportamiento no cambia.
- **Prompt**: instruir el tag sigue siendo responsabilidad del `system_prompt` (texto libre) del
  agente; el sistema no lo auto-edita.

## Alternativas consideradas
- **Mantener el enum y agregar una columna `payment_method` de texto:** dos campos que mantener
  coherentes; se prefirió un solo campo en texto libre.
- **Derivar la clave `method` del tag siempre (sin seed):** cambiaría `cod` por
  `compra-contra-entrega` en datos nuevos y partiría el corte "por método" respecto al histórico.
- **Tags de pago globales con un catálogo fijo ampliado:** no escala a mercados con métodos
  distintos y mezcla marcas; la config por agente es la unidad natural (como catálogo, horario y
  retargets).
