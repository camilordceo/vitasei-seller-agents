# ADR-0067: Sistema de diseño "Silent Sensei" con Tailwind estándar + next/font

- **Estado:** Aceptada
- **Fecha:** 2026-07-18
- **Sprint:** rediseño UX/UI (docs/27)

## Contexto

El rediseño del dashboard parte de un spec de marca (Stitch "The Silent Sensei") y un
mockup HTML de Claude Design con paleta propia (navy `#0F172A`, teal `#0D9488`, hairline
`#E2E8F0`), tipografías Geist + Inter y estilos inline. Había que decidir cómo llevar eso a
código: ¿paleta custom en Tailwind + CSS del mockup, o mapear al sistema estándar?

## Decisión

1. **Sin paleta custom**: los colores del spec coinciden 1:1 con Tailwind estándar
   (`slate-900`, `teal-600`, `slate-200`…). El sistema se impone por convención documentada
   (`docs/vitasei-software-design.md`) y por componentes compartidos (`app/dashboard/ui-kit.tsx`),
   no por tokens nuevos.
2. **Tipografía vía `next/font/google`** (Geist para display, Inter para cuerpo) expuestas
   como variables CSS (`--font-geist`, `--font-inter`) y clases `font-display`/`font-sans`.
3. **Solo presentación**: el rediseño no toca queries, actions ni esquema; los componentes
   client existentes conservan su lógica y cambian clases.
4. Donde el mockup contradecía la realidad (nav duplicado, KPIs ficticios, búsqueda muerta,
   inbox estático), gana la realidad — decisiones registradas en el doc de diseño §8.

## Consecuencias

- Cero mantenimiento de tokens duplicados; cualquier dev con Tailwind estándar es productivo.
- Riesgo: la disciplina depende del doc y del ui-kit; un color fuera de rol no falla el build.
- Geist/Inter se descargan en build (next/font las auto-hospeda); sin FOUT ni requests externos.

## Alternativas consideradas

- **Paleta custom (`brand.navy` etc.)**: más semántica, pero duplica lo que Tailwind ya trae
  y obliga a mantener el mapa; rechazada.
- **Copiar el CSS inline del mockup**: rápido pero inmantenible y sin responsive; rechazada.
- **shadcn/ui**: aporta primitivas, pero el dashboard ya tiene componentes server-first
  (`<details>`, `<form action>`) que cubren lo necesario sin dependencia nueva; rechazada.
