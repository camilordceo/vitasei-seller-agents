# 08 — Registro y documentación (cómo dejamos rastro)

Framework de **4 capas** para que siempre se sepa *qué se hizo* y *por qué*. Todo en el repo,
en texto plano. Claude Code lo mantiene como parte del trabajo (ver `CLAUDE.md`).

| Capa | Archivo / formato | Responde | Cuándo se escribe |
|------|-------------------|----------|-------------------|
| 1. Commits | Conventional Commits | Qué cambió (granular) | En cada commit |
| 2. Changelog | `CHANGELOG.md` (Keep a Changelog + SemVer) | Qué se entregó | Durante el sprint (Unreleased) y al cerrarlo |
| 3. Decisiones | `docs/decisions/NNNN-*.md` (ADR) | Por qué se decidió algo | Cuando se toma una decisión no trivial |
| 4. Sprint log | `docs/sprint-log/sprint-NN.md` | Qué pasó en el sprint | Al cerrar cada sprint |

## 1. Conventional Commits
Formato: `tipo(scope): descripción`. Tipos: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`.
Ejemplos:
```
feat(webhook): recibir message_created y encolar en Inngest
feat(agent): parser de tags #ID/#addi/#orden-lista
fix(gate): descartar #ID con SKU inexistente
docs(adr): ADR-0005 estrategia de debounce de mensajes
```

## 2. CHANGELOG.md
- Mientras se trabaja, todo va bajo `## [Unreleased]` en secciones `Added/Changed/Fixed/Removed`.
- Al cerrar un sprint, se mueve `[Unreleased]` a una versión con fecha (ej. `## [0.4.0] - 2026-07-15 — Sprint 4 (envío Callbell)`).
- Versionado simple: cada sprint sube la `minor` (0.1 → 0.2 → ...). Bugfixes sueltos suben la `patch`.

## 3. ADRs (decisiones)
- Un archivo por decisión, numerado: `docs/decisions/0005-titulo.md` (copiar de `0000-template.md`).
- Son **inmutables**: si una decisión cambia, se crea un ADR nuevo que marca al anterior como *Reemplazada por ADR-XXXX*.
- Disparador: cualquier elección con trade-off (librería, patrón, modelo, esquema). Si dudas, escríbelo.

## 4. Sprint log
- Al terminar un sprint, crear `docs/sprint-log/sprint-NN.md` desde `_template.md`.
- Registra: qué se hizo, checklist de aceptación con evidencia, desviaciones, ADRs nuevos, deuda técnica, archivos tocados.

## Definition of Done de un sprint
Un sprint está cerrado solo cuando:
1. Cumple su **criterio de aceptación** (doc 07).
2. `CHANGELOG.md` actualizado y versión movida de `[Unreleased]`.
3. `docs/sprint-log/sprint-NN.md` escrito.
4. ADR(s) creado(s) si hubo decisiones no triviales.
5. Commits en Conventional Commits y push hecho.
