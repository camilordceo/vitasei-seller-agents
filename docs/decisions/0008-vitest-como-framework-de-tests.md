# ADR-0008: Vitest como framework de tests

- **Estado:** Aceptada
- **Fecha:** 2026-06-30
- **Sprint:** 2

## Contexto
Hasta el Sprint 1 no había tests automatizados; la verificación era `tsc --noEmit` +
`next build` + pruebas manuales del dev server. El Sprint 2 introduce lógica **pura** con
reglas críticas para el producto (validación de catálogo: SKUs únicos/presentes — el SKU
es la join key del `#ID` y sostiene el gate anti-alucinación; generación del documento del
vector store; rutas de Storage). Esa lógica se puede —y debe— verificar sin tocar OpenAI ni
Supabase, que además aún no están aprovisionados. El Sprint 7 (Hardening) ya preveía QA, así
que conviene establecer el harness de tests desde ahora.

## Decisión
Adoptar **Vitest** como framework de tests unitarios. Config en `vitest.config.ts` con el
alias `@/` resuelto igual que en `tsconfig.json`; tests en `lib/**/*.test.ts`, entorno
`node`. Scripts `npm test` (`vitest run`) y `npm run test:watch`. Por ahora se testea solo
lógica pura (sin I/O); la orquestación con I/O se valida con build + pruebas de integración
cuando existan credenciales.

## Consecuencias
- **Bueno:** verificación real (no solo typecheck) de la lógica que rompe el gate si falla;
  feedback rápido; cero config de Babel (esbuild/Vite maneja TS); reutilizable en S3+ para el
  parser de tags y el gate. Misma cadena de tooling que Vite/ESM.
- **Malo / atado a futuro:** una dependencia de dev más (y su árbol). Los tests de I/O
  (OpenAI/Supabase) quedan pendientes hasta tener credenciales o mocks. El warning "CJS build
  of Vite is deprecated" es cosmético en Vitest 2.x.

## Alternativas consideradas
- **Jest:** estándar amplio, pero requiere `ts-jest`/Babel y más config; más lento; peor
  encaje con un proyecto ya ESM/Vite-friendly.
- **node:test (runner nativo):** cero dependencias, pero sin resolución de alias `@/` lista
  para usar ni el ergonomía de `expect`/watch que da Vitest.
- **Sin tests (solo `tsc` + build):** insuficiente para la lógica del gate; el typecheck no
  prueba comportamiento.
