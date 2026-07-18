# ADR-0060: Assistant de Synthflow referenciado, con prompt y contexto por llamada

- **Estado:** Aceptada
- **Fecha:** 2026-07-18
- **Sprint:** 8

## Contexto

Le damos voz al agente con Synthflow. El prompt de voz se edita en **nuestro** dashboard
(decisión de producto: hablar por teléfono ≠ escribir por chat; el prompt de WhatsApp está
lleno de tags `#ID`/`#orden-lista` e instrucciones de imágenes que en voz no aplican).

Eso obliga a resolver **cómo llega nuestro prompt a Synthflow**. Al inspeccionar la cuenta real
aparecieron dos hechos que pesan más que cualquier preferencia de diseño:

1. El workspace tiene **82 assistants** y es **compartido con otro producto** (Rentmies,
   inmobiliaria). Los dos assistants que nos pasaron son `type: "inbound"` y ya tienen su
   `external_webhook_url` apuntando a Bubble: mutarlos rompe un flujo en producción que no es
   nuestro.
2. `POST /v2/calls` acepta **`prompt`, `greeting` y `custom_variables` por llamada**
   (verificado contra el schema real).

## Decisión

**Referenciamos** un assistant por agente (`agents.synthflow_model_id`) y **no lo mutamos en
cada guardado**. El cerebro de la llamada viaja **por llamada**:

- `prompt` = prompt de voz del agente + contexto de esa conversación.
- `greeting` = saludo del agente.
- `custom_variables` = datos del contacto/conversación (nombre, producto, etc.), referenciables
  en el prompt con `{llaves}`.

Lo único que sí vive en el assistant, porque la API no lo acepta por llamada:
- la **voz** (`voice_id`) → se sincroniza con un botón explícito, con **read-modify-write**
  (`GET` → merge → `PUT`) para no borrar campos que no gestionamos;
- los **extractores** → se adjuntan al assistant (`/v2/actions/attach`), ver ADR-0062.

## Consecuencias

**Bueno**
- No tocamos assistants ajenos: la integración es *aditiva* sobre un workspace compartido.
- El prompt puede llevar contexto vivo (qué producto miraba, si tiene orden), que es
  justamente lo que hace útil la llamada. Con un prompt estático en Synthflow, no.
- Cero drift entre nuestra base y Synthflow: no hay estado duplicado que sincronizar.
- Cambiar el prompt no requiere llamar a su API: es un `UPDATE` nuestro.

**Malo / atado**
- El prompt que se ve en el panel de Synthflow **no** es el que corre. Queda documentado en el
  dashboard ("el prompt efectivo se arma acá") para que nadie lo depure en el lugar equivocado.
- Si Synthflow deprecara el override por llamada, habría que migrar a `PUT` por agente.
- La voz es el único campo con escritura remota → es el único que puede fallar por red al
  guardar; por eso es un botón aparte y no parte del guardado normal.

## Alternativas consideradas

- **Gestionar el assistant completo por `PUT` en cada guardado.** Descartada: `PUT` sobre un
  assistant compartido con semántica de reemplazo es la forma más rápida de borrarle campos a
  otro producto, y ata cada guardado del dashboard a que su API responda.
- **Crear el assistant automáticamente por agente.** Descartada para v1: multiplica objetos en
  un workspace ya con 82 y no aporta nada mientras el prompt viaje por llamada. Queda abierta
  como paso 2 si se quiere autoservicio total.
- **Prompt solo en Synthflow.** Descartada por producto: parte la configuración en dos lugares
  y deja el prompt de voz fuera del dashboard donde vive todo lo demás del agente.
