# Menus · Histórico

> Parte de [Menus](../menus.md) (la portada lista todas las partes): lo que ya no existe y por qué se quitó.

## Quitado

- **«Tipo de comida» is gone from the meal sheet** (2026-11-11, D-182 phase 1): it sent `pinnedType` but the server never used it. A type for this once is the picker's chip + «Que elija Mimoia» (PRO-1175); a type every week goes to the household's **semana tipo** (below; from the menu, «Más opciones → Guardar en mi semana tipo», PRO-1186). `pinnedType` and `MEAL_TYPE_TAGS` no longer exist; old clients' `pinnedType` is ignored.
