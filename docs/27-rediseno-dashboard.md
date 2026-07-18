# 27 — PRD: Rediseño UX/UI del dashboard ("Silent Sensei")

**Fecha:** 18 jul 2026 · **Alcance:** solo presentación (`app/dashboard/**`, layout, tokens).
Cero cambios en queries, server actions, webhooks o esquema.

## Contexto

El dashboard creció sección por sección con un estilo utilitario (header horizontal,
slate plano). Se hizo un proceso de marca: brand MD de Vitasei/Beauty Boost → spec de
software ("The Silent Sensei", Stitch) → mockup Claude Design (6 pantallas). Este rediseño
implementa ese sistema en producción, lo extiende a las secciones que el mockup no cubrió
(Inventario, Hotmart, Retargets, Llamadas, Videos) y corrige decisiones débiles del mockup.
Sistema completo en `docs/vitasei-software-design.md`.

## Objetivos

1. Identidad: pasar de "página interna" a producto (sidebar navy, Geist+Inter, teal).
2. Densidad con calma: más información visible con menos ruido (cards hairline, plegables).
3. Usabilidad admin en Inventario (la foto que manda el bot es el dato crítico).
4. Nada de datos inventados; toda métrica visible sale de una query real.

## Qué cambia por sección

| Sección | Cambio |
|---|---|
| Shell | Sidebar navy 264px con grupos Operación/Automatización/Análisis; header de página con h1 Geist; móvil: top bar + menú. |
| Resumen | KPIs rediseñados (tile de ícono + Geist 30px + barra real), accesos rápidos, conversaciones recientes restyled. |
| Conversaciones | Lista tipo inbox (avatar iniciales, chips), filtros plegables (ya existían), paginación pill. Detalle: chat estilo mockup (burbujas navy/blanco) + panel lateral 100% plegable por sección. |
| Órdenes | KPIs, segmented control de estados (patrón mockup), lista con avatar y montos alineados, paginación. |
| Inventario | **Rediseño completo**: KPIs de catálogo, búsqueda + filtros (todos/sin imagen/sin stock), grid de cards con foto grande, precio prominente, SKU mono, edición de link inline con preview. |
| Reportes | Se conserva TODO el contenido (ventas, costo IA, ROAS, conversión, horarios, productos); se re-viste al sistema y las secciones largas se hacen plegables. |
| Llamadas | Tabs restyled, KPIs nuevos, mismas listas. |
| Agentes | Lista → grid de cards con estado, proveedor y checklist de configuración; editor conserva estructura con cards del sistema. |
| Hotmart | Diseño propio (no estaba en mockup): explicación del flujo en 3 pasos, selector de agente, plantillas, carritos recientes con chips Enviado/No enviado. |
| Retargets | Mantiene los dos bloques plegables; stats bar y listas al nuevo estilo. |
| Videos | Manager conserva lógica; página y cards al nuevo estilo. |

## No-objetivos

- Búsqueda global (no hay endpoint) · dark mode · cambios de datos/negocio · i18n.

## Criterio de aceptación

`npm run build` verde; todas las rutas renderizan con el shell nuevo; los flujos existentes
(filtros por URL, server actions, chat manual, edición de imagen) siguen funcionando;
deploy a producción en Vercel.

## Registro

- ADR-0067: sistema de diseño con Tailwind estándar + next/font (sin paleta custom).
- CHANGELOG bajo `[Unreleased]`.
