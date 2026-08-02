# Migración a pnpm (WindChat / FugazChat)

> Objetivo: cambiar el gestor de paquetes de **npm** a **pnpm** sin romper el chat ni
> el E2EE. Solo afecta a la instalación / build / CI. El relay Rust y los binarios de
> Tauri no dependen de npm.

## Por qué
- Instalaciones más rápidas y deterministas (`pnpm-lock.yaml` + store global).
- Mejor para el CI de auto-update (Fase 4): `pnpm install --frozen-lockfile` reproducible.
- Aislamiento estricto de dependencias (menos "dependency confusion").

## Riesgos / lo que se rompe si solo cambias `npm` -> `pnpm`
1. `setup.ps1` y `run.ps1` llaman `npm install` -> hay que cambiarlos a `pnpm`.
2. Workspaces: pnpm usa `pnpm-workspace.yaml` (no el campo `workspaces` de package.json).
3. Hoisting estricto: scripts que asumen deps hoisteadas a la raíz fallarán; usar
   `pnpm -w run ...` o `pnpm --filter <pkg>`.
4. `postinstall` (`scripts/run-script.js fix-perms`): pnpm lo ejecuta; revisar que no
   dé warning bloqueante.
5. CI (`release.yml`) usa `npm ci` -> cambiar a `pnpm install --frozen-lockfile`.

## Pasos (verificables)

### 1. Migración de paquetes
- Crear `pnpm-workspace.yaml` con `packages: ["server", "client", "desktop"]`.
- Borrar `package-lock.json` y `node_modules/` (raíz y subpaquetes).
- `pnpm install` -> genera `pnpm-lock.yaml`.
- Verificar: `pnpm -w build` verde; `pnpm test` 92/92.

### 2. Scripts y runners
- `setup.ps1`: `npm install` -> `pnpm install` (y `--workspace` a `pnpm -w`).
- `run.ps1`: comandos `npm run ...` -> `pnpm -w run ...` (o `pnpm --filter`).
- `.github/workflows/release.yml`: `npm ci` -> `pnpm install --frozen-lockfile`;
  `npm run build` -> `pnpm -w build`.
- (Opcional) añadir `only-allow` para forzar pnpm en `npm install` accidental.

### 3. Commit + push
- Commit local `chore: migrar a pnpm` (tú haces el push a GitHub).

## Criterios de aceptación
- [ ] `pnpm install` genera `pnpm-lock.yaml` y node_modules sin errores.
- [ ] `pnpm -w build` verde (client + server + desktop portable opcional).
- [ ] `pnpm test` 92/92 verde.
- [ ] `pnpm run test:e2e` (integration: reconexión + diagnósticos) verde.
- [ ] `setup.ps1` y `run.ps1` usan pnpm y arrancan el dev correctamente.
- [ ] CI (`release.yml`) usa pnpm y el job de build pasa en seco (syntax check).
- [ ] `git status` sin `package-lock.json` ni node_modules (en .gitignore).

## Notas
- El relay Rust (`relay-rust/`) y `cargo` no cambian.
- El `.exe` de Tauri sigue sin construirse headless aquí; la migración no lo habilita.
- Para probar el chat no se necesita pnpm (ver README sección "Desktop app" / doc de
  prueba del chat).
