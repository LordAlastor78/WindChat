User: Realiza un plan exaustivo para migrar a Deno. Christian Amado

    Blog
    Biografía
    Contacto
    Diabetes
    Etiquetas
    |
    🇺🇸

Migración de Node.js a Deno: Caso práctico
agosto 21, 2024 4 minutos de lectura.
Web Development • Deno • Typescript • Node.js

En los últimos años, Deno ha emergido como una alternativa moderna a Node.js. Desarrollado por el mismo creador de Node.js, Deno busca abordar algunas de las limitaciones y problemas de diseño que han surgido con Node.js a lo largo del tiempo. Este artículo presenta un caso práctico detallado sobre cómo migrar una aplicación existente de Node.js a Deno, destacando las diferencias clave, los desafíos y las soluciones.
1. Introducción a Deno y sus ventajas

Deno es un runtime moderno para JavaScript y TypeScript basado en V8 y Rust. Se diferencia de Node.js por su enfoque en la seguridad, su soporte nativo para TypeScript y su sistema de módulos sin un administrador de paquetes como npm.
Ventajas principales de Deno:

    Seguridad por diseño: Deno ejecuta código en un sandbox, lo que significa que no tiene acceso a archivos, red o variables de entorno sin permisos explícitos.
    Soporte nativo para TypeScript: No se necesita configuración adicional para usar TypeScript.
    Gestor de módulos simplificado: Deno utiliza URLs para importar módulos, eliminando la necesidad de un archivo package.json.
    Ecosistema moderno: Con un enfoque en el desarrollo moderno, Deno integra herramientas como un linter y formateador.

2. Preparativos para la migración
Requisitos previos

Antes de comenzar la migración, asegúrate de tener lo siguiente:

    Conocimiento básico de TypeScript.
    Acceso al código fuente de la aplicación Node.js.
    Deno instalado. Puedes instalarlo siguiendo la documentación oficial.

Configuración del entorno

    Instalar Deno:

    curl -fsSL https://deno.land/install.sh | sh

    Configurar el editor: Si usas VS Code, instala la extensión oficial de Deno.

    Revisar dependencias existentes: Enumera todas las dependencias utilizadas en tu proyecto de Node.js para planificar su equivalencia en Deno.

3. Diferencias clave entre Node.js y Deno
Característica	Node.js	Deno
Sistema de módulos	CommonJS/ESM	ESM por defecto
Gestor de paquetes	npm/yarn	No tiene (usa URLs)
Soporte para TypeScript	Configuración adicional requerida	Soporte nativo
Seguridad	Sin restricciones	Requiere permisos explícitos
Herramientas integradas	No	Linter, formateador, test runner
4. Migrando una aplicación paso a paso
Caso práctico: API REST

Migraré una API REST básica en Node.js a Deno. La API utiliza Express y accede a una base de datos.
Estructura original en Node.js:

project/
├── package.json
├── src/
│   ├── index.js
│   ├── routes/
│   │   └── users.js
│   ├── controllers/
│   │   └── userController.js
│   └── db/
│       └── connection.js
└── tests/
    └── user.test.js

Paso 1: Migración de módulos

Deno no utiliza npm. En su lugar, los módulos se importan directamente desde URLs.

    En Node.js:

    const express = require('express');
    const app = express();

    En Deno:

    import { Application } from "https://deno.land/x/oak/mod.ts";
    const app = new Application();

Paso 2: Migración del código

Deno utiliza async/await de forma nativa para operaciones de red y archivo.

    Ejemplo: Middleware para JSON en Node.js:

    const express = require('express');
    const app = express();
    app.use(express.json());

    Equivalente en Deno:

    import { Application } from "https://deno.land/x/oak/mod.ts";
    const app = new Application();

    app.use(async (ctx, next) => {
        if (ctx.request.hasBody) {
            const body = await ctx.request.body().value;
            ctx.state.body = body;
        }
        await next();
    });

Paso 3: Manejo de dependencias

En lugar de package.json, Deno recomienda usar un archivo deps.ts para centralizar los módulos importados:

export { Application } from "https://deno.land/x/oak/mod.ts";

Paso 4: Ajustes en pruebas

Deno incluye un test runner integrado:

    Prueba en Node.js (Jest):

    test('should return all users', async () => {
        const res = await request(app).get('/users');
        expect(res.status).toBe(200);
    });

    Equivalente en Deno:

    import { assertEquals } from "https://deno.land/std/testing/asserts.ts";

    Deno.test("should return all users", async () => {
        const res = await fetch("http://localhost:8000/users");
        assertEquals(res.status, 200);
    });

5. Buenas prácticas para la migración

    Iniciar con módulos pequeños: Identifica partes autónomas del proyecto que puedan migrarse de manera independiente.
    Usar herramientas integradas: Aprovecha el formateador (deno fmt) y linter (deno lint) integrados para mantener un código limpio.
    Revisar permisos: Configura correctamente los permisos que tu aplicación necesita con --allow-*.
    Documentar el proceso: Mantén un registro de cambios y problemas encontrados para futuras migraciones.

6. Conclusión y aprendizajes

Migrar de Node.js a Deno requiere un cambio de mentalidad debido a sus diferencias fundamentales. Sin embargo, Deno ofrece un entorno más seguro, moderno y simplificado que puede resultar beneficioso a largo plazo. Este caso práctico demuestra que, aunque la migración puede ser desafiante, las herramientas y características de Deno hacen que valga la pena el esfuerzo.

Rastreadores y contenido de Disqus bloqueados

Sus ajustes de Floorp han impedido que este contenido le rastreara en diferentes sitios o se usara para publicidad.
Content from blocked embed:
© 2018 - 2026 Christian Amado · Desarrollado por Hugo & Coder.


GitHub Copilot: Scan server/backend for Deno migration

Scan client frontend/tooling

Scan root scripts and package config

Read memory [](file:///c%3A/Users/Alastor/AppData/Roaming/Code/User/workspaceStorage/c55cedb675d118517b472f82320900ed/GitHub.copilot-chat/memory-tool/memories/repo/windchat-technical-notes.md)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/server/package.json)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/server/tsconfig.json)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/shared/protocol.ts#1-1), lines 1 to 60

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/server/src/index.ts#1-1), lines 1 to 80

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/package.json)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/PROJECT_PLAN.md#1-1), lines 1 to 100

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/build.ps1)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/dev.ps1#1-1), lines 1 to 50

Searched for regex `require|import.*fs|import.*path|process\.|__dirname|__filename` (`**/client/src/**`), 1 result

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/README.md#1-1), lines 1 to 80

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/ROADMAP.md#1-1), lines 1 to 80

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/vitest.config.ts)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/vite.config.ts)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/package.json)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/server/src/index.ts#80-80), lines 80 to 200

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/server/src/protocol.ts#1-1), lines 1 to 50

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/tsconfig.json)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/package.json)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/server/package.json)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/run.ps1)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/setup.ps1)

Searched for regex `__dirname|__filename|process\.|fs\.|path\.|os\.|import.*node:` (`**/client/src/**`), no results

Searched for regex `CommonJS|require\(` (`**/client/**/*.ts`), no results

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/server/src/protocol.ts)

Searched for regex `test|spec` (`**/server/**`), 5 results

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/shared/protocol.d.ts#1-1), lines 1 to 50

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/run.en.ps1#1-1), lines 1 to 100

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/INDEX.md#1-1), lines 1 to 50

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/CLOUDFLARE_GUIDE.md#1-1), lines 1 to 60

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/vite.config.ts)

Searched for text `import.*from|export` (`**/client/src`), no results

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/package.json)

Searched for text `export|import` (`**/server/src/**`), 20 results

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/server/src/index.ts#200-200), lines 200 to 300

Searched for files matching `**/client/src/*.ts`, 9 matches

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/server/src/index.ts#1-1), lines 1 to 100

Searched for text `listen|process.env` (`**/server/src/index.ts`), 3 results

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/src/main.ts#1-1), lines 1 to 30

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/src/fileManager.ts#1-1), lines 1 to 30

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/src/websocket.ts#1-1), lines 1 to 30

Read memory [](file:///c%3A/Users/Alastor/AppData/Roaming/Code/User/workspaceStorage/c55cedb675d118517b472f82320900ed/GitHub.copilot-chat/memory-tool/memories/repo/windchat-technical-notes.md)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/server/src/index.ts#470-470), lines 470 to 485

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/server)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/shared)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/shared/protocol.js)

Read memory

Analyzing your answers...

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/server/src/index.ts#1-1), lines 1 to 400

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/vite.config.ts)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/vitest.config.ts)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/server/src/protocol.ts)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/server/package.json)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/shared/protocol.ts)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/package.json)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/package.json)

Searched for files matching `**/*cloudflare*tunnel*`, no matches

Searched for regex `cloudflare|tunnel`, 200 results

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/server/src/index.ts#400-400), lines 400 to 485

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/src/tests/crypto.test.ts)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/src/tests/integration.test.ts)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/src/tests/websocket.test.ts)

Searched for regex `import\.meta` (`**/client/src/**`), 1 result

Searched for regex `VITE_|import\.meta\.env` (`**/client/src/**`), 1 result

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/src/main.ts#150-150), lines 150 to 260

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/index.html#1-1), lines 1 to 260

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/chat.html#1-1), lines 1 to 260

Searched for text `<script` (`**/client/*.html`), 2 results

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/index.html#380-380), lines 380 to 403

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/chat.html#760-760), lines 760 to 777

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/src/websocket.ts#1-1), lines 1 to 260

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/src/crypto.ts)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/src/protocol.ts)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/run.ps1)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/dev.ps1)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/build.ps1)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/setup.ps1)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/tsconfig.json)

Created memory file [](file:///c%3A/Users/Alastor/AppData/Roaming/Code/User/workspaceStorage/c55cedb675d118517b472f82320900ed/GitHub.copilot-chat/memory-tool/memories/Yzc3MWFkMmYtZmI5Yi00ZmQzLTkwZmYtNzNhZWNmMDU2ZmI0/plan.md)

## Plan: Migracion completa a Deno

Migrar todo el repo a Deno sin Node: servidor con Deno.serve + WebSocket nativo, build/test con tooling Deno, y scripts/docs alineados al flujo local + Cloudflare actual.

**Steps**
1. Definir base Deno y tareas globales: fijar version de Deno para el equipo, crear el archivo de configuracion de Deno en la raiz con tasks (dev, build, test, lint, fmt), imports/alias para shared, y reglas de TS equivalentes al tsconfig actual. *Bloquea pasos 2-7*
2. Consolidar el protocolo compartido: usar protocol.ts como unica fuente de tipos/constantes, y actualizar imports en cliente y servidor para evitar duplicados. *Depende del paso 1*
3. Migrar servidor a Deno: reescribir index.ts para usar Deno.serve + upgradeWebSocket, reemplazar Node http/fs/path/process, mantener handlers `handleJoin`, `handleMessage`, `handleTyping`, `handleDisconnect`, `broadcastPeerJoined`, y conservar rate limiting y validaciones. Usar un file server de std para servir client/dist con los mismos headers de seguridad. *Depende del paso 2*
4. Ajustar cliente para Deno: actualizar imports a extensiones .ts y al protocolo compartido en websocket.ts y crypto.ts; reemplazar window.crypto por globalThis.crypto para que los tests corran en Deno; sustituir import.meta.env en main.ts por una fuente de configuracion en HTML o un objeto global inyectado por el build. *Depende del paso 2*
5. Reemplazar Vite/Vitest: crear scripts Deno para build y dev del cliente (bundle con esbuild en Deno, copia de client/public y HTML, y servidor estatico en 3000 con watch). Actualizar index.html y chat.html para apuntar al bundle generado. Retirar vite.config.ts y vitest.config.ts del flujo. *Puede ir en paralelo con paso 3 despues del paso 2*
6. Migrar tests a deno test: convertir crypto.test.ts, integration.test.ts y websocket.test.ts a la API de testing de Deno (asserts, Deno.test, steps) y limpiar imports. *Depende del paso 4*
7. Actualizar scripts y docs: cambiar npm por deno task en dev.ps1, build.ps1, setup.ps1, run.ps1, run.en.ps1 y ajustar guias en README.md, READMEes.md, CLOUDFLARE_GUIDE.md, SCRIPTS.md, PROJECT_PLAN.md. Mantener el flujo de Cloudflare (dos puertos en dev) salvo decision explicita de unificar. *Depende de pasos 3-5*
8. Limpieza Node: retirar package.json y dependencias del flujo, eliminar node_modules, y decidir si se conserva o depreca tsconfig; borrar artefactos generados para Node en shared (protocol.js, protocol.d.ts) si ya no se usan. *Depende de pasos 3-7*
9. Endurecer permisos y tareas: documentar flags Deno para server (allow-net/read/env) y asegurar que las tareas usen permisos minimos; actualizar healthchecks si dependen de npm. *Depende de pasos 3 y 7*

**Relevant files**
- index.ts — migrar HTTP + WebSocket a Deno y conservar la logica de rooms/rate limit
- protocol.ts — fuente unica de tipos/constantes
- protocol.ts — eliminar o redirigir a shared
- crypto.ts — globalThis.crypto y imports Deno
- websocket.ts — imports a shared y extensiones .ts
- main.ts — reemplazar import.meta.env para config publica
- crypto.test.ts — migracion a deno test
- integration.test.ts — migracion a deno test
- websocket.test.ts — migracion a deno test
- index.html — script tag hacia bundle nuevo
- chat.html — script tag hacia bundle nuevo
- vite.config.ts — retirar del flujo
- vitest.config.ts — retirar del flujo
- package.json — reemplazar tareas npm por Deno
- package.json — retirar dependencias Node
- package.json — retirar dependencias Node
- dev.ps1 — lanzar deno task dev:server y dev:client
- build.ps1 — ejecutar deno task build
- setup.ps1 — validar Deno en lugar de Node
- run.ps1 — mantener launcher, apuntar a run.en actualizado
- run.en.ps1 — reemplazar comandos npm por Deno
- README.md — actualizar guia de uso
- READMEes.md — actualizar guia de uso
- CLOUDFLARE_GUIDE.md — actualizar pasos de tunnel
- SCRIPTS.md — actualizar comandos
- PROJECT_PLAN.md — actualizar plan si aplica

**Verification**
1. Ejecutar deno task fmt y deno task lint para validar estilo y reglas.
2. Ejecutar deno task test y confirmar que las suites de crypto, integracion y websocket pasan.
3. Ejecutar deno task dev y validar UI en el puerto 3000 y WS en 8080.
4. Ejecutar run.en en modo Cloudflare y verificar acceso remoto a chat.html y handshake.
5. Ejecutar deno task build y validar que server sirve client/dist con headers de seguridad.

**Decisions**
- Alcance completo (server + client + scripts + docs).
- Runtime local/self-hosted con Cloudflare Tunnel.
- Eliminar Node y npm del flujo.
- Migrar tests a deno test.

Si quieres ajustar el plan (por ejemplo unificar a un solo puerto o compilar el server a binario), lo adapto.

User: Start implementation

GitHub Copilot: Optimizing tool selection...

Searched for regex `VITE_SERVER_URL|SERVER_URL|PUBLIC_URL` (`**/client/src/**`), 1 result

Searched for regex `import\.meta\.env|VITE_` (`**/client/**`), 3 results

Searched for regex `VITE_` (`**/README*|CLOUDFLARE_GUIDE.md|SCRIPTS.md|PROJECT_PLAN.md|INDEX.md`), no results

Searched for regex `serverUrl|ws://|wss://|VITE_SERVER_URL|PUBLIC_URL` (`**/client/src/**`), 14 results

Searched for regex `VITE_SERVER_URL|SERVER_URL` (`**/*.md`), 2 results

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/src/main.ts#260-260), lines 260 to 360

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/src/main.ts#700-700), lines 700 to 820

Searched for regex `npm\s+run|node\s|npm\s+install|yarn|pnpm` (`**/run.en.ps1`), 14 results

Searched for regex `dev:server|dev:client|build:server|build:client` (`**/run.en.ps1`), 6 results

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/run.en.ps1)

Created 5 todos

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/.env.example)

Searched for regex `\.js"` (`**/client/src/**`), 6 results

Searched for regex `\.js"` (`**/server/src/**`), 3 results

Searched for regex `npm\s+run|node\s` (`**/*.ps1`), 21 results

Searched for regex `npm\s+run|node\s` (`**/*.ps1`), 21 results

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/healthcheck.ps1)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/run_backup.ps1)

Searched for regex `npm\s|Node\.js|node\s|Vite|Vitest|pnpm|yarn|VITE_` (`**/README.md|READMEes.md|CLOUDFLARE_GUIDE.md|SCRIPTS.md|PROJECT_PLAN.md|INDEX.md|ROADMAP.md`), no results

Searched for regex `npm|Node|Vite|Vitest|VITE_|cloudflared|Deno` (`**/README.md`), 45 results

Searched for regex `npm|Node|Vite|Vitest|VITE_|cloudflared|Deno` (`**/READMEes.md`), 45 results

Searched for regex `npm|Node|Vite|Vitest|VITE_|cloudflared|Deno` (`**/CLOUDFLARE_GUIDE.md`), 6 results

Searched for regex `npm|Node|Vite|Vitest|VITE_|cloudflared|Deno` (`**/SCRIPTS.md`), 25 results

Created [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/deno.json)

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/src/fileManager.ts#1-1), lines 1 to 260

Read [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/public/service-worker.js)

Searched for regex `shared/protocol\.(js|d\.ts)|protocol\.js` (`**/*.ts`), 8 results

Created [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/tools/build_client.ts)

Created [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/tools/dev.ts)

Starting: *Migrate shared protocol and imports* (2/5)

Generating patch (35 lines) in [](file:///c%3A/Users/Alastor/Desktop/personal/WindChat/client/src/crypto.ts)


```

```


Made changes.

User: @agent Try Again

GitHub Copilot: 

User: @agent Try Again

GitHub Copilot: 

User: Continúa la migración

GitHub Copilot: Compacted conversation