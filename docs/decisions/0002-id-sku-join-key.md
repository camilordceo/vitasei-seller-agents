# ADR-0002: El SKU (#ID) es la join key entre vector store y Supabase

- **Estado:** Aceptada
- **Fecha:** 2026-06-29
- **Sprint:** diseño (pre-0)

## Contexto
El conocimiento del producto vive en dos lados: el catálogo en el vector store (donde el agente
razona) y la tabla `products` en Supabase (de donde sale imagen y precio). Hay que unirlos de
forma confiable y evitar que el modelo invente productos/precios.

## Decisión
Usar el **SKU como clave única compartida**. El agente emite `#ID:<sku>`; el backend hace lookup
en `products`. El catálogo del vector store y la tabla `products` deben tener SKUs idénticos.

## Consecuencias
- La tabla `products` actúa como **gate anti-alucinación**: un `#ID` con SKU inexistente no se envía.
- La importación de catálogo debe validar consistencia SKU↔catálogo, o el `#ID` no encuentra imagen.
- Las imágenes y precios son deterministas (no dependen del LLM).

## Alternativas consideradas
- **Pedirle la imagen/precio al LLM:** descartado, alucina precios e inventa productos.
- **Solo tabla, sin vector store:** perdería la flexibilidad de Q&A sobre specs/FAQs del catálogo.
