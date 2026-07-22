# ADR-0078: Decir siempre en qué moneda está leída la pantalla (y delatar el mercado sin configurar)

- **Estado:** Aceptada
- **Fecha:** 2026-07-22
- **Sprint:** 6 (reportes)

## Contexto

Con ADR-0077, Reportes ya homologaba correctamente: convierte cada monto desde la moneda
**del agente** dueño de la conversación antes de sumar. Aun así, en producción el total
seguía saliendo mal. La causa no era el código: **los cuatro agentes tenían
`agents.currency = 'COP'`**, incluidos *Vitasei Mexico* y *Vitasei USA*. El dashboard
preguntaba la moneda del mercado, el mercado respondía "pesos", y las ventas en dólares se
sumaban crudas — `1.058` (MXN) + `98,07` (USD) mostrados como "$1.156".

El problema de fondo es que la migración 0029 declaró la columna `not null default 'COP'`.
Eso hace **indistinguibles** dos estados muy distintos: "este mercado vende en pesos" y
"nadie configuró este mercado todavía". Con cuatro agentes de tres países marcados en la
misma moneda, la pantalla se veía perfectamente sana. Nada avisaba.

También faltaba lo simétrico: al filtrar un agente, la lectura pasa a **su** moneda
(un ROAS de EE.UU. leído en pesos no le sirve a quien compra la pauta en dólares), pero
nada lo enunciaba — un `$ 96` en pantalla se puede leer como pesos.

## Decisión

La página **siempre dice en qué moneda está parada**, con tres estados y dos tonos:

1. **Un agente filtrado** (gris, informativo): "Leyendo en USD · Dólar — la moneda de
   Vitasei USA. Sin conversiones: son sus precios tal cual."
2. **Todos, con monedas distintas** (ámbar): "Todos los mercados sumados en COP" + la tasa
   usada + la invitación a filtrar un agente para verlo en su moneda.
3. **Todos, con una sola moneda entre VARIOS agentes** (ámbar, el caso nuevo): "Los 4
   agentes están configurados en COP… si algún mercado vende en otra moneda, ponlo en
   Agentes → En qué moneda vende: hasta entonces sus ventas se suman como si fueran COP",
   con enlace directo al editor.

El estado 3 es una **heurística deliberada**, no una verdad: varios agentes compartiendo
moneda es perfectamente legítimo (dos marcas en Colombia). Se acepta el falso positivo
porque el costo de equivocarse es leer un aviso de más, y el costo de no avisar ya se pagó:
meses de totales falsos que nadie podía detectar mirando la pantalla.

## Consecuencias

- El error de configuración deja de ser invisible: quien abra Reportes con mercados sin
  marcar ve el aviso y el enlace para arreglarlo, en vez de un total plausible y falso.
- Una operación legítima de un solo país con dos agentes verá el aviso ámbar aunque no
  tenga nada que corregir. Es ruido aceptado; si molesta, el siguiente paso es distinguir
  "sin configurar" de verdad (columna nullable o un `configured_at`) en vez de adivinar.
- La nota de agente filtrado aparece siempre que haya más de un agente, incluso en COP:
  saber que **no** hay conversión de por medio también es información.
- No se tocó ningún dato de producción: la moneda de cada mercado la pone el dueño en
  `/dashboard/agents`, que es donde vive esa decisión de negocio.

## Alternativas consideradas

- **Escribir las monedas por SQL desde acá**: rápido, pero es una decisión de negocio
  (Hotmart MX, por ejemplo, cobra en dólares aunque el público sea mexicano — no se deduce
  del nombre) y el editor de agente ya existe para eso.
- **Hacer `agents.currency` nullable para distinguir "sin configurar"**: es la solución
  correcta de fondo y queda anotada, pero obliga a una migración y a decidir qué hace el
  resto del código con un null. El aviso resuelve hoy el 100% del daño observable.
- **Adivinar la moneda por el nombre o el número de WhatsApp del agente** ("MX" → MXN,
  `+1` → USD): mágico y frágil; un agente de EE.UU. puede facturar en pesos y un número
  `+1` atiende México (de hecho, los tres agentes no colombianos tienen número `+1`).
- **Dejar de convertir y mostrar un total por mercado**: no responde "¿cuánto vendimos?",
  que es la pregunta del titular. La tabla del ROAS ya da la lectura por mercado.
