# 28 · API de gasto real en pauta

> **Para el integrador.** Este documento es el contrato completo: se puede mandar tal cual
> a quien conecte las cuentas de anuncios. Ver ADR-0082 para el porqué de cada decisión.

## Qué resuelve

El dashboard calcula el retorno (ROAS) de cada agente. Hasta ahora la inversión era una
**estimación**: `chats × costo por chat`, un promedio configurado a mano en `/dashboard/agents`.

Esta API recibe el **gasto real** por día desde el producto que ya tiene conectadas las
cuentas de anuncios. Cuando llega el dato de un día, ese día se lee con la plata que se pagó
de verdad; los días sin dato siguen usando el promedio. El costo por chat manual **no
desaparece**: queda como piso.

## Endpoint

```
POST https://<host>/api/ingest/ad-spend
Authorization: Bearer <AD_SPEND_API_KEY>
Content-Type: application/json
```

El token lo entrega Vitasei. Sin él (o con uno equivocado) la respuesta es `401`.

## Cuerpo

```json
{
  "rows": [
    {
      "agent_id": "8f3c1e2a-....",
      "date": "2026-07-21",
      "platform": "meta",
      "account_id": "act_123456",
      "campaign_id": "23851234567890123",
      "campaign_name": "Colágeno · CTWA · Bogotá",
      "spend": 152340.55,
      "currency": "COP",
      "impressions": 20100,
      "clicks": 430,
      "leads": 88
    }
  ]
}
```

También se acepta el arreglo pelado (`[ {...}, {...} ]`), sin la envoltura `rows`.

### Campos

| Campo | Obligatorio | Notas |
|---|---|---|
| `agent_id` | sí¹ | UUID del agente en Vitasei. **Es la forma preferida.** |
| `whatsapp_number` | sí¹ | Alternativa: el número del agente (`573001112233`, con o sin `+` y espacios). |
| `agent` | sí¹ | Alternativa: nombre o marca exactos. Se **rechaza si es ambiguo** (dos agentes que coincidan). |
| `date` | sí | `YYYY-MM-DD`. Es el día del reporte de la plataforma; se lee como día de Bogotá. |
| `spend` | sí | Número o string numérico. `>= 0`. Un `0` es válido (día pautado sin consumo). |
| `currency` | sí | `COP`, `USD` o `MXN`. Otra moneda se rechaza (no tenemos tasa y saldría un número falso). |
| `platform` | no | `meta` (default), `google`, `tiktok`, … Se normaliza a minúsculas. |
| `account_id` | no | Cuenta publicitaria, para auditar. |
| `campaign_id` | no | Sin él, la fila se entiende como **el total del agente ese día**. |
| `campaign_name` | no | Para leerlo en la auditoría. |
| `impressions`, `clicks`, `leads` | no | Enteros `>= 0`. `leads` es lo que reporta la plataforma. |

¹ Basta **una** de las tres formas de identificar el agente.

### Idempotencia — importante

La llave es **`agent_id + date + platform + campaign_id`**, y el envío **reemplaza**, no suma.

Eso significa que reenviar los últimos 7 días cada noche es la forma **correcta** de usar
esta API: las plataformas reexpresan el gasto reciente por las ventanas de atribución, y el
reenvío corrige el dato en vez de duplicarlo.

Si el mismo par día/campaña viene dos veces en un mismo request, gana la última fila.

### Límites

- Máximo **1000 filas por request** (`413` si te pasas). Un backfill se parte en lotes.

## Respuesta

```json
{ "ok": true, "received": 300, "upserted": 300, "rejected": 0, "errors": [] }
```

**Una fila mala no tumba el lote.** Las buenas se guardan y las malas vuelven con su índice:

```json
{
  "ok": false,
  "received": 300,
  "upserted": 299,
  "rejected": 1,
  "errors": [
    { "index": 42, "field": "currency", "message": "currency sin tasa: EUR. Soportadas: COP, USD, MXN" }
  ]
}
```

`ok` es `true` solo si **todas** las filas entraron. Se devuelven máximo 50 errores en detalle.

### Códigos

| Código | Qué pasó |
|---|---|
| `200` | Procesado (revisa `rejected` y `errors`). |
| `400` | JSON inválido o el cuerpo no trae un arreglo de filas. |
| `401` | Token ausente o incorrecto. |
| `413` | Más de 1000 filas. |
| `503` | El servidor no tiene `AD_SPEND_API_KEY` configurada. |
| `500` | Error guardando (el mensaje lo dice). |

## Verificar lo enviado

```
GET /api/ingest/ad-spend?from=2026-07-15&to=2026-07-21&agent_id=<uuid>&limit=200
Authorization: Bearer <AD_SPEND_API_KEY>
```

Devuelve las filas guardadas y un total **por moneda, sin convertir** — así se cuadra
directo contra el reporte de la plataforma.

## Ejemplo

```bash
curl -X POST https://<host>/api/ingest/ad-spend \
  -H "Authorization: Bearer $AD_SPEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"rows":[{"agent_id":"8f3c1e2a-...","date":"2026-07-21","spend":152340.55,"currency":"COP","leads":88}]}'
```

## Cómo se lee después en el dashboard

En **Reportes → Retorno (ROAS)**:

- La columna **Inversión** trae una etiqueta: `real` (todo reportado), `mixto` (unos días sí
  y otros estimados) o `estimado` (ningún dato real todavía).
- Una nota dice **cuántos días** hay reportados y **hasta cuándo**. Si el último dato tiene
  2 días o más, la nota se pone en ámbar: el envío se cayó.
- El gráfico de 14 días marca con un punto lleno los días con gasto reportado.
- Se muestra la brecha **leads de la plataforma vs. chats reales**: cuánta de la gente que
  la plataforma contó como lead efectivamente escribió.

## Lo que esta versión NO hace

- **No hay ROAS por campaña.** Guardamos el gasto por campaña, pero las conversaciones no
  traen todavía el `ad_id` de origen, así que atribuir una venta a una campaña sería
  inventar. Cuando la conversación traiga el anuncio de origen (CTWA), el dato ya está
  guardado y el reporte se abre solo.
- **No convierte con tasas del día.** Se usan las tasas fijas de `lib/dashboard/currency.ts`
  (ver ADR-0068), para que la lectura sea reproducible.

## Puesta en marcha (checklist)

1. Correr `supabase/migrations/0031_ad_spend.sql`.
2. Generar el token (`openssl rand -hex 32`) y ponerlo como `AD_SPEND_API_KEY` en Vercel
   (Production **y** Preview) y en `.env.local`.
3. Entregar al integrador: el token, la URL y los `agent_id` (se ven en `/dashboard/agents`).
4. Pedirle un envío de prueba de un día y verificar con el `GET`.
