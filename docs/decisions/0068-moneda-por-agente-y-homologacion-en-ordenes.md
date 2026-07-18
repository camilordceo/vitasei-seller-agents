# 0068 — Moneda por agente y homologación de Órdenes

- Estado: Aceptada
- Fecha: 2026-07-18
- Contexto relacionado: ADR-0055 (métodos de pago por agente), ADR-0065 (costo por chat y ROAS), docs/12 (Órdenes)

## Contexto

Vitasei vende en tres mercados con tres monedas: Colombia (COP), Estados Unidos (USD)
y México (MXN). La sección Órdenes no sabía nada de eso:

1. **La lista pintaba TODO con `formatCOP`.** Una orden de US$ 49,90 se leía "$ 49,90"
   con formato colombiano — cincuenta pesos en vez de doscientos mil.
2. **El resumen se rendía ante la mezcla.** `OrdersSummary.currency` era
   `string | null`: si convivían monedas devolvía `null` y la tarjeta decía
   "varias monedas" sobre un número que igual sumaba pesos con dólares.
3. **No se podía filtrar por agente.** Ni siquiera existía la opción de aislar un
   mercado, que es la forma natural de leer un número sin ambigüedad de moneda.
4. **La causa raíz: `orders.currency` nunca se escribía.** La columna tiene
   `default 'COP'` (migración 0001) y ninguno de los tres sitios que crean órdenes
   (el bot en `processMessage`, la orden manual desde una conversación, la orden
   manual suelta) la seteaba. Resultado: **toda orden en la base dice "COP"**,
   incluidas las de México. El dato existía y era mentira.

## Decisión

### 1. La moneda vive en el agente (`agents.currency`, migración 0029)

Columna nueva, **separada de `cost_currency`** (ADR-0065). Son decisiones distintas:
`cost_currency` es la moneda en la que se PAGA la pauta y `currency` es en la que se
VENDE. Hoy coinciden en los tres mercados, pero fusionarlas obligaría a migrar datos
el día que alguien pague pauta en USD y facture en COP. Se edita con un `<select>` en
el editor de agente, junto a Costo por chat.

### 2. Se sella en cada orden que nace

Los tres puntos de creación estampan `currency: agentCurrency(agent)`. Sin esto la
feature arreglaría la lectura pero seguiría guardando el dato mal.

### 3. Al LEER, manda el agente — no `orders.currency`

Decisión incómoda pero correcta: `currencyOf()` resuelve la moneda de una orden por
**el agente de su conversación**, y solo cae al valor guardado cuando la orden no
tiene agente (manuales sueltas). Motivo: el histórico completo dice "COP" por el
default, así que confiar en la columna dejaría la feature rota para todo lo anterior
a este ADR. El trade-off es que si un agente cambia de moneda, su histórico se
reinterpreta — aceptable: un agente cambia de mercado casi nunca, y una orden mal
leída todos los días es peor.

### 4. Filtrando por agente manda su moneda; viendo todos, se elige

- `?agent=<id>` → los totales se leen en la moneda de ESE agente y el selector de
  moneda **se oculta** (un control sin efecto es peor que uno ausente).
- Sin agente → `?cur=COP|USD|MXN` homologa toda la mezcla a esa moneda y suma.

### 5. Tasas fijas en código, con el USD como pivote

```
1 USD = 3.500 COP    1 USD = 20 MXN    ⇒  1 MXN = 175 COP (derivada)
```

MXN↔COP se **deriva** en vez de guardarse: una tercera tasa suelta puede
contradecir a las otras dos. Fijas a propósito — la lectura tiene que ser estable y
reproducible, y v1 no depende de un proveedor de FX. Cuando el negocio pida tasas
reales esto se muda a una tabla `fx_rates` con fecha y solo cambia de dónde sale
`USD_RATES`.

### 6. Honestidad en el número

- Se convierte ANTES de sumar y se redondea **una sola vez al final**: redondear por
  fila arrastra el error N veces y el total deja de cuadrar con la lista.
- Lo que no tiene tasa **se excluye y se cuenta** (`summary.excluded`), y la página lo
  dice en un aviso. Sumarlo como si ya estuviera en la moneda destino inventaría plata.
- Cuando el número es una equivalencia nuestra, la tarjeta muestra la tasa usada
  ("homologado a USD · 1 USD = 3.500 COP"). Un total en dólares sin esa nota se lee
  como un dato del banco.
- En la lista, la fila muestra el monto convertido y **debajo el importe real** que se
  cobró, cuando difieren.

## Alternativas descartadas

- **Reusar `cost_currency`.** Sin migración, pero conflacía pauta con venta.
- **Confiar en `orders.currency`.** Es lo "correcto" en abstracto y deja la feature
  rota para todo el histórico (ver punto 3).
- **Tasas en base de datos / API de FX.** Fuera de alcance para v1 y hace que el mismo
  filtro dé números distintos según el día. El código ya está listo para el cambio.
- **Convertir en SQL.** Las órdenes ya se barren en JS (`getOrdersPage`); meter FX en
  PostgREST complicaba sin ganar nada al volumen actual.

## Consecuencias

- `lib/dashboard/currency.ts` es el único lugar con tasas. Puro y testeado (18 casos):
  reversibilidad, derivación MXN↔COP, exclusión sin tasa, redondeo único.
- `OrdersSummary.currency` deja de ser `string | null` y pasa a `CurrencyCode`: siempre
  hay una moneda concreta en la que se está leyendo.
- Se corrigió de paso el `formatCOP` de `OrderList` (bug 1).
- **Requiere aplicar la migración 0029** y luego poner la moneda de cada agente en el
  dashboard. Sin la migración nada se rompe: `normalizeCurrency` cae a COP y el
  comportamiento es el de hoy.
