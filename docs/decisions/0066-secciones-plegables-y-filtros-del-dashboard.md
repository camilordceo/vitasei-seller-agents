# ADR-0066: Secciones plegables con `<details>` y filtros que se resuelven en JS

- **Estado:** Aceptada
- **Fecha:** 2026-07-18
- **Sprint:** mejoras de dashboard

## Contexto

Las páginas del dashboard crecieron por acumulación: Conversaciones llegó a seis filas de
filtros siempre visibles, Agentes apila el editor de WhatsApp y el de voz (dos formularios
largos), y Retargets muestra dos automatismos completos con sus listas de 100 filas. En un
portátil hay que hacer scroll para llegar a lo que se vino a hacer.

Al mismo tiempo hacían falta filtros nuevos que no se resuelven con un `WHERE` directo:
rango de fechas exacto y "sin etiqueta" en Conversaciones; teléfono/nombre y producto en
Órdenes, esta última con totales que deben cubrir **todo** el filtro y no solo la página.

## Decisión

**Plegar con `<details>`/`<summary>` nativos** (`app/dashboard/Collapsible.tsx`). El estado
abierto/cerrado lo lleva el navegador: el componente no usa hooks ni `"use client"`, así que
sirve igual en un server component (Conversaciones, Órdenes, Retargets) que dentro de uno de
cliente (VoiceSettings). Teclado, foco y "buscar en la página" funcionan sin código nuestro, y
el contenido sigue montado al cerrar, así que un formulario a medio llenar no se pierde.
Las secciones cerradas muestran en el encabezado un resumen de lo que esconden (filtros
activos, "Activadas/Apagadas", cuántas filas), para no tener que abrirlas a ver si hay algo.

**Los filtros que cruzan tablas se resuelven en JS**, siguiendo lo que ya hacían los reportes:

- "Sin etiqueta" **no toca la consulta**: se filtra en JS con las etiquetas que la lista ya trae
  para pintar los chips (cero consultas extra), pidiendo una ventana más ancha y recortando la
  página después — el mismo mecanismo que ya usaba "con/sin pedido".
  El primer intento fue resolverlo en la consulta (materializar el complemento y pasarlo a
  `.in("id", ...)`), apostando a que el conjunto sin clasificar sería el chico. **Contra la base
  real dio 400**: casi ninguna conversación está etiquetada, así que "sin etiqueta" es casi toda
  la tabla y la lista de UUIDs revienta el largo de la URL de PostgREST. La misma razón descarta
  el `not.in` con el conjunto invertido en cuanto las etiquetas se usen de verdad.
- Órdenes barre todas las órdenes y filtra en memoria, porque buscar por teléfono cruza
  `contacts`, buscar por producto cruza `order_items`, y el resumen del encabezado (ventas,
  ticket promedio) tiene que sumar el filtro completo, no la página visible.

El rango de fechas usa días calendario de Bogota (UTC-5 fijo, sin DST) con el extremo "hasta"
inclusivo, implementado como `>= inicio(desde)` y `< inicio(hasta + 1 día)`. Rango exacto y
atajo de días (7/30/90) son **excluyentes**: los dos acotan la misma columna y mezclarlos daría
una ventana ambigua, así que elegir uno limpia el otro.

## Consecuencias

- Cero JavaScript para plegar y ningún estado que sincronizar; el precio es que **el estado no
  persiste** entre navegaciones (cada carga vuelve al default). Se acepta: guardarlo pediría
  cliente + almacenamiento para un ahorro de un clic.
- El barrido en JS es correcto y simple con el volumen v1, pero es **O(todas las órdenes)** por
  carga de página. Es el mismo trade-off ya asumido en los reportes y está anotado en el código:
  si el volumen crece, esto se muda a una vista/RPC en Postgres sin cambiar la firma.
- Los filtros que se resuelven en JS (**sin etiqueta**, **con/sin pedido**) paginan sobre una
  ventana acotada (tope 1000 filas de PostgREST), no sobre toda la tabla. Con el volumen v1 no
  se alcanza; el día que se alcance, esas páginas profundas quedarían cortas — otra razón para
  mudar el cruce a la BD.
- Los filtros nuevos viven en la URL, así que una búsqueda se comparte pegando el link.

## Alternativas consideradas

- **Un acordeón con estado en React** (o una librería de UI). Da animación y persistencia, pero
  obliga a volver client component varias páginas que hoy son server components, por un
  problema que `<details>` resuelve con cero dependencias.
- **Empujar los filtros de Órdenes a PostgREST** (`or=` sobre el embed de `contacts`). Filtra,
  pero deja los totales del encabezado fuera de alcance: habría que hacer una segunda consulta
  de agregación por cada filtro, duplicando la lógica.
- **Guardar los filtros por usuario.** No hay modelo de usuario en el dashboard (va detrás de
  Basic Auth); la URL cumple la misma función y además se comparte.
