# ADR-0080: El método de pago que se configura en el agente manda en TODO el dashboard

- **Estado:** Aceptada
- **Fecha:** 2026-07-22
- **Sprint:** 6+ (mantenimiento)

## Contexto

Desde ADR-0055 cada agente define sus propios métodos de pago en `agents.payment_methods`
(`[{tag, label, method}]`) porque cada mercado cobra distinto: Colombia contra entrega y
Addi, EE.UU. Zelle, y ahora Colombia además "Link de pago". El backend ya respetaba eso:
detecta el tag, fija `conversations.fulfillment_method` (texto libre desde la 0025) y crea
la orden con esa clave.

El dashboard no. Tres listas cableadas seguían diciendo cuáles eran "los métodos":

1. `OrderEditor` (detalle de orden) ofrecía exactamente **contra entrega / Addi / sin
   definir**. Un método nuevo del agente NO se podía elegir a mano: la orden se corregía
   con el método equivocado o se dejaba "sin definir".
2. `MethodPill` (listas de órdenes y conversaciones, y sus detalles) traducía con un mapa
   de tres claves y, ante cualquier otra, caía a **"Sin definir"**. Una venta por Zelle o
   por link de pago se veía en pantalla como si el cliente no hubiera elegido nada — no era
   una etiqueta fea, era información falsa.
3. Reportes ya leía las etiquetas de los agentes, pero un método recién configurado no
   aparecía en el corte "por método" hasta la primera venta, así que no había forma de
   confirmar que había quedado bien puesto.

## Decisión

Un solo lugar resuelve `método → etiqueta` y `agente → opciones`: `lib/dashboard/methodLabels.ts`
(puro, con tests). El dashboard deja de tener listas propias.

- **Órdenes (detalle):** el selector se arma con los métodos del agente que vendió
  (`getOrder` ahora devuelve `agentId` + `paymentMethods`, vía la conversación), más
  "Sin definir", más —si hace falta— el método actual de la orden, para que un método que
  se quitó de la config no desaparezca del select y se cambie solo al guardar.
- **Píldoras:** `MethodPill` recibe el mapa de etiquetas de los agentes de esa pantalla.
  Sin mapa, cae a las claves históricas (`cod`/`addi`/`undecided`) y, si tampoco, al
  nombre derivado de la clave (`link-de-pago` → "Link de pago"). Nunca más a "Sin definir".
- **Reportes:** los métodos configurados en el agente aparecen siempre en "por método",
  aunque tengan 0 órdenes (`summarizeOrders(..., configuredMethods)`).

## Consecuencias

- Agregar un método en Agentes es suficiente: aparece en el selector de Órdenes, se lee con
  su nombre en las listas y detalles, y sale en Reportes desde el minuto cero.
- Las claves históricas `cod`/`addi` siguen fijas como respaldo para no partir órdenes
  viejas ni reportes de agentes que aún no tienen `payment_methods` cargado.
- Si dos agentes usan la misma clave con etiquetas distintas, en las listas consolidadas
  gana el primero por orden de creación. Es un empate improbable y sin consecuencia en los
  números (agregan por clave, no por etiqueta).
- `getOrder` hace una consulta más (los métodos del agente), best-effort: si falta la
  migración 0025 el detalle igual abre, solo que con las opciones históricas.

## Alternativas consideradas

- **Volver a un enum de métodos:** mata el multi-mercado que ADR-0055 vino a resolver.
- **Dejar que la píldora muestre siempre la clave cruda:** honesto pero feo, y pierde la
  etiqueta que el dueño escribió ("Link de Pago" ≠ `link-de-pago`).
- **Pasar la config del agente a un contexto global de React:** el dashboard es server-first;
  pasarla por props desde cada página es más simple y no agrega estado de cliente.
