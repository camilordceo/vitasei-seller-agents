# Vitasei — Sistema de diseño de software ("The Silent Sensei")

> Fuente de verdad del diseño del dashboard. Derivado del brand MD de Vitasei / Beauty Boost,
> del spec de Stitch ("The Silent Sensei") y del mockup de Claude Design (18 jul 2026), con
> decisiones propias documentadas abajo. Complementa `voice-and-content.md` (misma carpeta de
> referencia) — las reglas de voz aplican a TODA cadena visible.

## 1. Persona

El software es el **Sensei**: autoridad silenciosa, precisión, calma. No vende, no celebra,
no decora. Informa y ejecuta. El retail de Vitasei grita; el software susurra.

- Cero signos de exclamación y cero emojis en la UI.
- La UI **no inventa datos**: si una métrica no existe, no se muestra un placeholder bonito.
  (El mockup traía KPIs ficticios — latencia, tendencias %, metas — que aquí no existen; no
  se imitan hasta tener el dato real.)
- El éxito se confirma, no se festeja: "Cambios guardados", "Pedido #4821 creado".

## 2. Color

La paleta del spec mapea 1:1 a Tailwind estándar — **no hay paleta custom**, hay disciplina:

| Rol | Token Tailwind | Hex | Uso |
|---|---|---|---|
| Estructura (nav) | `slate-900` | `#0F172A` | Sidebar, botones primarios, números grandes |
| Superficie nav 2 | `slate-800` | `#1E293B` | Cards dentro de la sidebar |
| Acción / acento | `teal-600` | `#0D9488` | CTA afirmativo, estados activos, foco, marca |
| Acento suave | `teal-50` | `#F0FDFA` | Fondos de ícono/chip teal |
| Fondo base | `slate-50` | `#F8FAFC` | Fondo del workspace |
| Superficie | `white` | `#FFFFFF` | Cards |
| Hairline | `slate-200` | `#E2E8F0` | Bordes 1px de cards y tablas |
| Texto | `slate-900` / `slate-600` / `slate-400` | — | Título / cuerpo / metadato |
| Éxito | `emerald-50/700` | — | Chips "Confirmada", "Enviado" |
| Pendiente | `amber-50/700` | — | Chips "Pendiente", avisos 24 h |
| Error | `rose-50/700` | — | Chips "Cancelada", "Falló" |

Reglas: la sidebar es el ÚNICO bloque navy grande; teal se usa **poco** (un CTA por vista,
estados activos, la marca). Los chips de estado usan fondo desaturado + texto oscuro, nunca
color puro. Gráficos: teal + navy + neutros; nada de arcoíris.

## 3. Tipografía

Dos fuentes vía `next/font/google` (variables CSS, cero FOUT):

- **Geist** (`font-display`): títulos y números grandes. Tracking apretado (−0.02 a −0.035em).
- **Inter** (`font-sans`): cuerpo y UI. line-height 1.5–1.6.

Escala: h1 30px/600 · título de card 17px/600 · cuerpo 14px · metadato 12–12.5px ·
label de tabla/KPI 11px/600 uppercase tracking `.08em` · KPI 30–34px Geist.
Números en tablas siempre `tabular-nums`.

## 4. Capas y profundidad

Profundidad por **capas tonales**, no por sombras: fondo `slate-50` → card blanca con borde
hairline `slate-200` → hover = tinte (`hover:bg-slate-50`), nunca elevación. Solo dropdowns y
modales llevan sombra ambiental suave. Radios: **16px cards (`rounded-2xl`)**, 8–10px
controles (`rounded-lg`), pill 9999 chips.

## 5. Layout

- **Sidebar fija 264px navy** (desktop ≥1024px) con secciones: Operación / Automatización /
  Análisis. En móvil colapsa a top bar con menú desplegable.
  *Decisión propia:* el mockup repartía Videos/Hotmart/Retargets en un segundo nav en el
  header — dos sistemas de navegación es un anti-patrón; aquí TODO vive en la sidebar,
  agrupado por función.
- Workspace `max-w-[1440px]`, padding 24–32px, gutter 20px, baseline 4px.
- Header de página: h1 Geist 30px + descripción ≤15 palabras + acciones a la derecha.
- Móvil: una columna, tablas → cards de lista, touch targets ≥44px.

## 6. Componentes canónicos (`app/dashboard/ui-kit.tsx`)

- **Card**: blanca, borde hairline, `rounded-2xl`, padding 20–24px.
- **KpiCard**: tile de ícono 40px arriba-izquierda, label uppercase 11px, valor Geist 30px,
  sub 12px. Barra de progreso solo si existe una proporción real.
- **Chip de estado**: pill, fondo desaturado, 11–12px/600. Sin íconos dentro.
- **Botones**: primario navy (`slate-900`), afirmativo teal (guardar/enviar), secundario
  blanco + hairline. Verbos concretos. Altura 40–44px.
- **Inputs**: hairline, `rounded-lg`, foco = ring teal fino (nunca glow grueso).
- **Tablas**: header 11px uppercase `slate-400`, filas con divisor `slate-100`,
  hover tinte. En móvil degradan a lista.
- **Collapsible**: `<details>` nativo (sin JS). Toda sección secundaria de una vista larga
  debe poder plegarse; el título muestra un resumen de lo que hay adentro para poder leerlo
  cerrado.
- **EmptyState**: título ≤6 palabras + explicación de cuándo aparecerá el dato + acción si
  existe. Nunca un "No hay datos" seco.

## 7. Interacción

- Transiciones 120–200ms solo en color/fondo; `fadeUp` 280ms al entrar una vista.
- Hover en filas = tinte; nada "se levanta".
- Foco visible siempre (`focus-visible:ring-2 ring-teal-500`).
- Estados de carga describen lo que ocurre ("Calculando inventario"), no "Cargando…".
- Acciones destructivas nombran la consecuencia y piden confirmación.

## 8. Decisiones propias vs. el mockup (registro)

1. **Un solo nav** (sidebar agrupada) en vez de sidebar + nav secundario en header.
2. **Sin datos ficticios**: fuera KPIs de latencia/metas/tendencias que el backend no calcula.
3. **Conversaciones**: se mantiene lista server-rendered con filtros/paginación (cientos de
   conversaciones reales > inbox estático de 4 filas del mockup); el detalle adopta el layout
   de 3 zonas del mockup con **panel lateral plegable por sección**.
4. **Búsqueda global del header**: se omite en v1 (no existe el endpoint); el header muestra
   contexto y acciones reales. No se pinta un input muerto.
5. **Inventario** (no estaba en el mockup): vista de administrador — KPIs del catálogo,
   búsqueda + filtros (sin imagen / sin stock), grid de cards con foto grande y edición de
   link de imagen inline. La foto es el dato crítico (es lo que el bot manda por WhatsApp),
   así que se le da el mayor peso visual.
6. **Hotmart** (no estaba): flujo explicado en 3 pasos arriba (webhook → plantilla →
   conversación), configuración en cards, carritos recientes como tabla con chips.
7. **Toggle switch** para encendido/apagado de agentes y features (patrón del mockup) pero
   con `<form action>` server-first donde ya existía.
