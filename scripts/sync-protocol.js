#!/usr/bin/env node
/**
 * sync-protocol.js — Propaga shared/protocol.ts a client y server.
 *
 * El proyecto no puede importar directamente desde shared/ porque cliente y
 * servidor compilan con rootDir separados (Vite bundlea el cliente, tsc emite
 * el servidor). En lugar de mantener tres copias a mano — que ya divergieron
 * una vez — generamos las copias desde una única fuente de verdad.
 *
 * Uso:
 *   node scripts/sync-protocol.js          → escribe las copias
 *   node scripts/sync-protocol.js --check  → falla si están desincronizadas (CI)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'shared', 'protocol.ts');
const TARGETS = [
    path.join(ROOT, 'client', 'src', 'protocol.ts'),
    path.join(ROOT, 'server', 'src', 'protocol.ts'),
];

const BANNER = [
    '// ⚠️ ARCHIVO GENERADO — NO EDITAR A MANO.',
    '// Fuente: shared/protocol.ts · Regenerar: npm run sync:protocol',
    '',
].join('\n');

function readSource() {
    if (!fs.existsSync(SOURCE)) {
        console.error(`✖ No se encuentra la fuente: ${SOURCE}`);
        process.exit(1);
    }
    // Normalizar a LF para que la comparación no falle por CRLF en Windows
    return BANNER + fs.readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n');
}

function normalize(text) {
    return text.replace(/\r\n/g, '\n');
}

const checkMode = process.argv.includes('--check');
const expected = readSource();
let drifted = false;

for (const target of TARGETS) {
    const rel = path.relative(ROOT, target);
    const current = fs.existsSync(target)
        ? normalize(fs.readFileSync(target, 'utf8'))
        : null;

    if (current === expected) {
        if (!checkMode) console.log(`= ${rel} (sin cambios)`);
        continue;
    }

    if (checkMode) {
        console.error(`✖ ${rel} está desincronizado con shared/protocol.ts`);
        drifted = true;
        continue;
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, expected, 'utf8');
    console.log(`✔ ${rel} actualizado`);
}

if (checkMode) {
    if (drifted) {
        console.error('\nEjecuta `npm run sync:protocol` y vuelve a commitear.');
        process.exit(1);
    }
    console.log('✔ Protocolo sincronizado en client y server');
}
