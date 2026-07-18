# ADR-0065: Costo por chat por agente y lectura de retorno (ROAS)

- **Estado:** Aceptada
- **Fecha:** 2026-07-18
- **Sprint:** mejoras de dashboard

## Contexto

El dashboard ya mostraba lo que ENTRA (ventas, conversión, órdenes) y lo que cuesta operar la
IA (tokens, audio, llamadas), pero no lo que cuesta **conseguir** cada conversación. Ese es el
gasto grande: hoy en Colombia una conversación sale en ~$1.000 COP de pauta. Sin ese número el
equipo no puede responder la pregunta que importa —*¿esto está devolviendo la plata?*— y las
ventas se leían como si fueran ganancia.

Tres restricciones del negocio condicionan cómo se modela:

1. **El costo es por mercado, no del proyecto.** Cada agente es una marca/número en un país
   distinto, con su propia pauta y su propio costo por chat.
2. **Conviven monedas.** Colombia factura pauta en COP y el agente de EE.UU. (ADR-0055,
   `#zelle`) en USD. Sumarlos daría un número falso.
3. **El costo cambia.** El CPL de julio no es el de agosto.

## Decisión

Dos columnas nuevas en `agents` (migración `0028`): `cost_per_chat numeric` y
`cost_currency text default 'COP'`, editables desde el editor de agente. Con eso, Reportes gana
una sección **Retorno (ROAS)** con tabla por agente y gráfico de inversión vs. ventas por día.

Definiciones que fija esta decisión:

- Un **chat** es una conversación que recibió al menos un mensaje del cliente. Se detecta con
  `conversations.last_inbound_at` (una sola lectura) en vez de barrer `messages`.
- El costo se imputa el día en que **llegó** la conversación (`conversations.created_at`), que
  es cuando se pagó por ese lead — no el día en que el cliente volvió a escribir.
- **Inversión** = chats × costo por chat. **ROAS** = ventas generadas ÷ inversión. Se muestra
  también el **ROAS confirmado** (solo órdenes `confirmed`), que es la lectura conservadora.
- `NULL` ≠ `0`: un agente sin costo configurado aparece con sus chats y ventas, pero con ROAS
  vacío. Un `0` daría retorno infinito, y un default heredado se leería como dato real.
- **Nunca se suma entre monedas.** El consolidado y el gráfico solo se calculan cuando todo el
  alcance comparte moneda; si no, la tabla muestra las filas y explica por qué no consolida.

## Consecuencias

- El equipo ve el retorno real por marca, y el costo por venta (CPA) sale gratis del mismo dato.
- El costo por chat es **un valor vigente, sin historia**. Un ROAS histórico calculado con el
  costo de hoy es aproximado: al cambiar el número, el pasado se recalcula. Se acepta para v1
  (el dato hoy no existe en ninguna parte, y esto ya responde la pregunta). Si hace falta
  precisión histórica, el camino es una tabla `agent_costs` con vigencia (`valid_from`) y
  atribuir cada chat al costo vigente ese día — sin tocar la UI ni las definiciones de arriba.
- La atribución es **por conversación**, no por campaña: no distingue de qué anuncio vino el
  lead. Alcanza para decidir por mercado, no para optimizar creativos.
- El cálculo tolera que falte la migración: sin las columnas, todos los agentes quedan "sin
  configurar" y Reportes sigue cargando (mismo criterio que 0023/0026).

## Alternativas consideradas

- **Un costo global del proyecto (env var).** Más simple, pero borra la diferencia entre
  mercados, que es justo lo que se quiere ver, y no sobrevive a la segunda moneda.
- **Costo con vigencia desde el día uno** (`agent_costs` con `valid_from`). Es lo correcto a
  largo plazo, pero triplica el esquema y la UI para un dato que hoy nadie está registrando.
  Queda documentado arriba como el siguiente paso, no descartado.
- **Costo por venta en vez de por chat.** Es lo que el equipo negocia con las agencias, pero se
  deriva (inversión ÷ órdenes) y se muestra igual en la tabla; pedirlo como insumo obligaría a
  estimar los chats hacia atrás.
- **Traer el gasto real desde la API de Meta Ads.** Es la fuente de verdad, pero mete una
  integración, credenciales y un modelo de atribución completo para responder algo que un
  número editable ya responde.
