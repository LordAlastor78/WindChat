#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const script = process.argv[2];
if (!script) {
    console.error('Usage: node run-script.js <healthcheck|setup|dev|run>');
    process.exit(2);
}

const mapping = {
    healthcheck: { win: './healthcheck.ps1', unix: './scripts/healthcheck.sh' },
    setup: { win: './setup.ps1', unix: './scripts/setup.sh' },
    dev: { win: './dev.ps1', unix: './scripts/dev.sh' },
    run: { win: './run.ps1', unix: './scripts/run.sh' }
};

function fixPerms() {
    // Make all .sh files in ./scripts executable on Unix
    const scriptsDir = path.resolve(__dirname);
    try {
        const files = fs.readdirSync(scriptsDir);
        files.forEach(f => {
            if (f.endsWith('.sh')) {
                const p = path.join(scriptsDir, f);
                try {
                    fs.chmodSync(p, 0o755);
                    console.log('chmod +x', p);
                } catch (err) {
                    console.warn('Could not chmod', p, err.message);
                }
            }
        });
    } catch (err) {
        console.warn('Could not read scripts directory for fixing perms:', err.message);
    }
}

if (!mapping[script]) {
    console.error('Unknown script:', script);
    process.exit(2);
}

function existsSync(p) { try { return fs.existsSync(p); } catch (e) { return false } }

const isWin = process.platform === 'win32';

// Special helper command to fix permissions after install
if (script === 'fix-perms' || script === 'fixperms' || script === 'fix_perms') {
    if (!isWin) fixPerms();
    process.exit(0);
}

const target = isWin ? mapping[script].win : mapping[script].unix;

if (!existsSync(path.resolve(target))) {
    console.error('Target script not found:', target);
    process.exit(2);
}

// On Unix ensure the script is executable
if (!isWin) {
    try {
        fs.chmodSync(path.resolve(target), 0o755);
    } catch (err) {
        // non-fatal
    }
}

let cmd, args;
if (isWin) {
    // prefer pwsh if available
    const pwsh = (() => { try { const p = require('child_process').spawnSync('pwsh', ['-v']); return p.status === 0; } catch (e) { return false } })();
    if (pwsh) {
        cmd = 'pwsh';
        args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', target];
    } else {
        cmd = 'powershell';
        args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', target];
    }
} else {
    cmd = 'bash';
    args = [target];
}

const child = spawn(cmd, args, { stdio: 'inherit', shell: false });
child.on('exit', (code) => process.exit(code));
child.on('error', (err) => { console.error(err); process.exit(1); });
