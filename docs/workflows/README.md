# Cambios de workflow propuestos

Los agentes de Mimoia HQ no suben nada de `.github/` (lo aparta el filtro de la oficina). Cuando una tarea necesita cambiar un workflow, el cambio va aquí y lo aplica Miguel o la sesión del Mac:

- `ci-e2e-web-compilada.patch` (PRO-398): el job de e2e contra la web compilada (`next build` + el servidor standalone, `apps/web/scripts/boot-built-web.sh`) en vez de `next dev`, con la caché de `.next/cache`. Se aplica desde la raíz del repo con `git apply docs/workflows/ci-e2e-web-compilada.patch`.
