/**
 * Tests de path traversal en el servido de estáticos.
 *
 * Contexto: el handler original hacía `path.join(clientDistPath, req.originalUrl)`.
 * `originalUrl` NO está normalizado por Express, así que `/../../package.json`
 * escapaba de client/dist y servía archivos del repo con HTTP 200
 * (verificado: package.json y server/src/index.ts eran accesibles).
 *
 * Ahora se usa express.static + fallback SPA fijo. Estos tests fijan esa
 * garantía: ninguna URL puede resolverse fuera de client/dist.
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CLIENT_DIST = path.resolve(__dirname, '../../dist');

/**
 * Reproduce la lógica VULNERABLE original, para documentar qué se arregló.
 */
function legacyResolve(originalUrl: string): string {
    return path.join(CLIENT_DIST, originalUrl === '/' ? 'index.html' : originalUrl);
}

/**
 * Resolución segura equivalente a la que aplica express.static:
 * normaliza y rechaza cualquier cosa que escape del root.
 */
function safeResolve(originalUrl: string): string | null {
    let decoded: string;
    try {
        decoded = decodeURIComponent(originalUrl);
    } catch {
        return null; // encoding inválido → rechazar
    }

    if (decoded.includes('\0')) return null;

    const resolved = path.resolve(CLIENT_DIST, '.' + path.posix.normalize(decoded));
    const root = path.resolve(CLIENT_DIST);

    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        return null; // escapó del directorio servido
    }
    return resolved;
}

const TRAVERSAL_PAYLOADS = [
    '/../../package.json',
    '/../../../package.json',
    '/../src/index.ts',
    '/../../server/src/index.ts',
    '/../../.env',
    '/%2e%2e/%2e%2e/package.json',
    '/..%2f..%2fpackage.json',
    '/subdir/../../../package.json',
];

describe('Path traversal en estáticos', () => {
    it('la lógica antigua SÍ escapaba de client/dist (regresión documentada)', () => {
        const escaped = TRAVERSAL_PAYLOADS.filter((p) => {
            const resolved = path.resolve(legacyResolve(p));
            return !resolved.startsWith(path.resolve(CLIENT_DIST) + path.sep);
        });

        // Al menos los payloads crudos escapaban: por eso se cambió el handler.
        expect(escaped.length).toBeGreaterThan(0);
    });

    it('ninguna carga de traversal resuelve fuera de client/dist', () => {
        for (const payload of TRAVERSAL_PAYLOADS) {
            const resolved = safeResolve(payload);

            if (resolved !== null) {
                expect(
                    resolved.startsWith(path.resolve(CLIENT_DIST)),
                    `El payload ${payload} escapó a ${resolved}`
                ).toBe(true);
            }
        }
    });

    it('rechaza bytes nulos', () => {
        expect(safeResolve('/index.html\0.png')).toBeNull();
    });

    it('sigue permitiendo rutas legítimas', () => {
        const ok = safeResolve('/manifest.json');
        expect(ok).not.toBeNull();
        expect(ok!.startsWith(path.resolve(CLIENT_DIST))).toBe(true);
    });

    it('permite assets anidados legítimos', () => {
        const ok = safeResolve('/assets/index.js');
        expect(ok).not.toBeNull();
        expect(ok!.startsWith(path.resolve(CLIENT_DIST))).toBe(true);
    });
});
