#!/usr/bin/env node
/**
 * Tests for fetch-berachain-snapshot-v2.js (BERA-912).
 *
 * Run: node apps/node-scripts/test-fetch-berachain-snapshot-v2.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'fetch-berachain-snapshot-v2.js');
const FIXTURE_CATALOG = path.join(__dirname, 'test-fixtures', 'v2-catalog.csv');
const FIXTURE_CATALOG_URL = `file://${FIXTURE_CATALOG}`;
const V1_SCRIPT = path.join(__dirname, 'fetch-berachain-snapshot.js');
const V1_BASELINE = spawnSync('git', ['show', 'origin/main:apps/node-scripts/fetch-berachain-snapshot.js'], {
    cwd: path.join(__dirname, '..', '..'),
    encoding: 'utf8',
}).stdout;
const SYSTEM_TAR =
    spawnSync('sh', ['-c', 'command -v tar'], { encoding: 'utf8' }).stdout.trim() || '/usr/bin/tar';

let failures = 0;

function runScript(args, env = {}) {
    return spawnSync(process.execPath, [SCRIPT, ...args], {
        encoding: 'utf8',
        env: { ...process.env, ...env },
    });
}

function test(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failures++;
        console.log(`  ✗ ${name}`);
        console.log(`    ${err.message}`);
    }
}

function makeTempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function clPayloadStub() {
    return `#!/bin/sh
tmp=$(mktemp -d)
echo restored > "$tmp/restored.txt"
tar -c -C "$tmp" .
rm -rf "$tmp"
`;
}

function passthroughLz4Stub() {
    return '#!/bin/sh\nif [ "$1" = "-d" ]; then cat; else echo "unexpected lz4 args: $*" >&2; exit 1; fi\n';
}

function noopTarStub() {
    return '#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in -x|-f) shift;; -C) shift 2;; *) shift;; esac; done\n';
}

function restoreStubs(extra = {}) {
    return {
        curl: clPayloadStub(),
        lz4: passthroughLz4Stub(),
        tar: `#!/bin/sh\nexec ${SYSTEM_TAR} "$@"\n`,
        ...extra,
    };
}

function writeStubBin(stubs) {
    const dir = makeTempDir('snapv2-bin-');
    for (const [name, body] of Object.entries(stubs)) {
        const filePath = path.join(dir, name);
        fs.writeFileSync(filePath, body, { mode: 0o755 });
    }
    return dir;
}

function startHttpServer(body, statusCode = 200) {
    return new Promise((resolve) => {
        const server = http.createServer((_req, res) => {
            res.writeHead(statusCode, { 'Content-Type': 'text/csv' });
            res.end(body);
        });
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ server, url: `http://127.0.0.1:${port}/catalog.csv` });
        });
    });
}

function main() {
    console.log('\nfetch-berachain-snapshot-v2 tests\n');

    test('TP-3: --beacon-only and --el-only are mutually exclusive', () => {
        const result = runScript([
            '--network',
            'bepolia',
            '--beacon-only',
            '--el-only',
            '--no-download',
        ]);
        assert.notStrictEqual(result.status, 0);
        assert.match(result.stderr, /beacon-only.*execution-only|execution-only.*beacon-only/i);
    });

    test('TP-1: --type pruned selects el-manifest, --minimal, and cl-pruned', () => {
        const result = runScript([
            '--network',
            'bepolia',
            '--type',
            'pruned',
            '--catalog-url',
            FIXTURE_CATALOG_URL,
            '--no-download',
        ]);
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stdout, /bera-reth download.*--minimal/);
        assert.match(result.stdout, /manifest\.json/);
        assert.match(result.stdout, /beacon-kit-pruned-22980000\.tar\.lz4/);
        assert.doesNotMatch(result.stdout, /beacon-kit-archive/);
    });

    test('TP-1: --type archive selects el-manifest, --archive, and cl-pruned', () => {
        const result = runScript([
            '--network',
            'bepolia',
            '--type',
            'archive',
            '--catalog-url',
            FIXTURE_CATALOG_URL,
            '--no-download',
        ]);
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stdout, /bera-reth download.*--archive/);
        assert.match(result.stdout, /beacon-kit-pruned-22980000\.tar\.lz4/);
        assert.doesNotMatch(result.stdout, /beacon-kit-archive/);
    });

    test('TP-1: --full-cl selects cl-archive regardless of --type', () => {
        const result = runScript([
            '--network',
            'bepolia',
            '--type',
            'pruned',
            '--full-cl',
            '--catalog-url',
            FIXTURE_CATALOG_URL,
            '--no-download',
        ]);
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stdout, /beacon-kit-archive-22980000\.tar\.lz4/);
        assert.doesNotMatch(result.stdout, /beacon-kit-pruned/);
    });

    test('TP-2: missing catalog exits non-zero with stderr gap', () => {
        const missing = `file://${path.join(makeTempDir('snapv2-missing-'), 'missing.csv')}`;
        const result = runScript(['--network', 'bepolia', '--catalog-url', missing, '--no-download']);
        assert.notStrictEqual(result.status, 0);
        assert.match(result.stderr, /catalog|ENOENT|no such file/i);
    });

    test('TP-2: missing required role exits non-zero', () => {
        const badCatalog = makeTempDir('snapv2-badcatalog-');
        const badPath = path.join(badCatalog, 'catalog.csv');
        fs.writeFileSync(
            badPath,
            `type,layer,profile,block_number,size_bytes,created_at,object_key,download_url,role
reth,el,,1,1,2026-01-01T00:00:00Z,v2/bepolia/reth/manifest.json,https://example.test/manifest.json,el-manifest
`,
        );
        const result = runScript([
            '--network',
            'bepolia',
            '--catalog-url',
            `file://${badPath}`,
            '--no-download',
        ]);
        assert.notStrictEqual(result.status, 0);
        assert.match(result.stderr, /cl-pruned|role/i);
    });

    test('TP-2: dirty target directory exits non-zero', () => {
        const output = makeTempDir('snapv2-output-');
        const clDir = path.join(output, 'bepolia-pruned-cl');
        fs.mkdirSync(clDir, { recursive: true });
        fs.writeFileSync(path.join(clDir, 'dirty'), 'x');
        const result = runScript([
            '--network',
            'bepolia',
            '--type',
            'pruned',
            '--output',
            output,
            '--catalog-url',
            FIXTURE_CATALOG_URL,
        ]);
        assert.notStrictEqual(result.status, 0);
        assert.match(result.stderr, /not empty/i);
    });

    test('TP-4: --no-download prints restore commands and does not invoke curl', () => {
        const curlLog = path.join(makeTempDir('snapv2-curllog-'), 'curl.log');
        const bin = writeStubBin({
            curl: `#!/bin/sh\necho "$*" >> "${curlLog}"\nexit 99\n`,
        });
        const result = runScript(
            [
                '--network',
                'bepolia',
                '--catalog-url',
                FIXTURE_CATALOG_URL,
                '--no-download',
            ],
            { PATH: `${bin}:${process.env.PATH}` },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stdout, /bera-reth download/);
        assert.match(result.stdout, /curl .*lz4 -d \| tar/);
        assert.doesNotMatch(result.stdout, /reth-pruned|reth-archive/);
        assert.ok(!fs.existsSync(curlLog), 'curl must not run in --no-download mode');
    });

    test('TP-5: missing bera-reth prints EL command and stderr skip with exit 0', () => {
        const output = makeTempDir('snapv2-output-');
        const bin = writeStubBin(restoreStubs());
        const clDir = path.join(output, 'bepolia-pruned-cl');
        const result = runScript(
            [
                '--network',
                'bepolia',
                '--output',
                output,
                '--catalog-url',
                FIXTURE_CATALOG_URL,
            ],
            { PATH: `${bin}:${process.env.PATH}` },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stderr, /bera-reth.*skipped/i);
        assert.match(result.stdout, /bera-reth download/);
        assert.ok(fs.readdirSync(clDir).length > 0);
    });

    test('TP-6: v1 fetch-berachain-snapshot.js is byte-identical to origin/main', () => {
        const current = fs.readFileSync(V1_SCRIPT, 'utf8');
        assert.strictEqual(current, V1_BASELINE);
    });

    test('TP-7: mainnet missing v2 catalog fails closed with generic error (not v1 fallback)', () => {
        const missing = `file://${path.join(makeTempDir('snapv2-mainnet-'), 'missing.csv')}`;
        const result = runScript(['--network', 'mainnet', '--catalog-url', missing, '--no-download']);
        assert.notStrictEqual(result.status, 0);
        assert.doesNotMatch(result.stderr, /fetch-berachain-snapshot\.js/);
        assert.doesNotMatch(result.stderr, /index\.csv/);
    });

    test('TP-8: bera-reth stub receives manifest-url, datadir, and --minimal', () => {
        const output = makeTempDir('snapv2-output-');
        const rethLog = path.join(output, 'reth.log');
        const elDir = path.join(output, 'bepolia-pruned-el');
        const bin = writeStubBin(
            restoreStubs({
                'bera-reth': `#!/bin/sh\necho "$@" >> "${rethLog}"\nmkdir -p "${elDir}"\necho el > "${elDir}/restored.txt"\nexit 0\n`,
            }),
        );
        const result = runScript(
            [
                '--network',
                'bepolia',
                '--output',
                output,
                '--catalog-url',
                FIXTURE_CATALOG_URL,
                '--reth-bin',
                path.join(bin, 'bera-reth'),
            ],
            { PATH: `${bin}:${process.env.PATH}` },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        const argv = fs.readFileSync(rethLog, 'utf8');
        assert.match(argv, /--manifest-url/);
        assert.match(argv, /manifest\.json/);
        assert.match(argv, new RegExp(`--datadir ${elDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
        assert.match(argv, /--minimal/);
    });

    test('TP-9: default run creates both named empty dirs before restore', () => {
        const output = makeTempDir('snapv2-output-');
        const elDir = path.join(output, 'bepolia-pruned-el');
        const clDir = path.join(output, 'bepolia-pruned-cl');
        const stateLog = path.join(output, 'state.log');
        const bin = writeStubBin(
            restoreStubs({
                curl: `#!/bin/sh
el_count=$(ls -A "${elDir}" 2>/dev/null | wc -l | tr -d ' ')
cl_count=$(ls -A "${clDir}" 2>/dev/null | wc -l | tr -d ' ')
echo "curl el_empty=$el_count cl_empty=$cl_count" >> "${stateLog}"
tmp=$(mktemp -d)
echo cl > "$tmp/restored.txt"
${SYSTEM_TAR} -c -C "$tmp" .
rm -rf "$tmp"
`,
                'bera-reth': `#!/bin/sh
el_count=$(ls -A "${elDir}" 2>/dev/null | wc -l | tr -d ' ')
echo "reth el_empty=$el_count" >> "${stateLog}"
mkdir -p "${elDir}"
echo el > "${elDir}/restored.txt"
exit 0
`,
            }),
        );
        const result = runScript(
            [
                '--network',
                'bepolia',
                '--output',
                output,
                '--catalog-url',
                FIXTURE_CATALOG_URL,
            ],
            { PATH: `${bin}:${process.env.PATH}` },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        assert.ok(fs.existsSync(elDir));
        assert.ok(fs.existsSync(clDir));
        const state = fs.readFileSync(stateLog, 'utf8');
        assert.match(state, /curl el_empty=0 cl_empty=0/);
        assert.match(state, /reth el_empty=0/);
    });

    test('TP-10: CL pipeline uses cl-pruned URL and leaves CL dir non-empty', () => {
        const output = makeTempDir('snapv2-output-');
        const curlLog = path.join(output, 'curl.log');
        const clDir = path.join(output, 'bepolia-pruned-cl');
        const bin = writeStubBin(
            restoreStubs({
                curl: `#!/bin/sh\necho "$*" >> "${curlLog}"\n${clPayloadStub().replace('#!/bin/sh\n', '')}`,
                'bera-reth': '#!/bin/sh\nexit 0\n',
            }),
        );
        const result = runScript(
            [
                '--network',
                'bepolia',
                '--output',
                output,
                '--catalog-url',
                FIXTURE_CATALOG_URL,
                '--reth-bin',
                path.join(bin, 'bera-reth'),
            ],
            { PATH: `${bin}:${process.env.PATH}` },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        const curlArgs = fs.readFileSync(curlLog, 'utf8');
        assert.match(curlArgs, /beacon-kit-pruned-22980000\.tar\.lz4/);
        assert.ok(fs.readdirSync(clDir).length > 0);
    });

    test('TP-11: missing bera-reth still restores CL while EL dir stays empty', () => {
        const output = makeTempDir('snapv2-output-');
        const clDir = path.join(output, 'bepolia-pruned-cl');
        const elDir = path.join(output, 'bepolia-pruned-el');
        const bin = writeStubBin(restoreStubs());
        const result = runScript(
            [
                '--network',
                'bepolia',
                '--output',
                output,
                '--catalog-url',
                FIXTURE_CATALOG_URL,
            ],
            { PATH: `${bin}:${process.env.PATH}` },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stderr, /bera-reth.*skipped/i);
        assert.ok(fs.existsSync(clDir));
        assert.ok(fs.readdirSync(clDir).length > 0);
        assert.ok(!fs.existsSync(elDir) || fs.readdirSync(elDir).length === 0);
    });

    test('TP-12: CHAIN env var sets the default network, matching env.sh/setup-reth.sh', () => {
        const result = runScript(
            ['--catalog-url', FIXTURE_CATALOG_URL, '--no-download'],
            { CHAIN: 'bepolia' },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stdout, /--chain bepolia/);
    });

    test('TP-12: --network still overrides CHAIN when both are set', () => {
        const result = runScript(
            ['--network', 'bepolia', '--catalog-url', FIXTURE_CATALOG_URL, '--no-download'],
            { CHAIN: 'mainnet' },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stdout, /--chain bepolia/);
    });

    test('TP-12: an invalid CHAIN value is ignored, falling back to mainnet', () => {
        const result = runScript(
            ['--catalog-url', FIXTURE_CATALOG_URL, '--no-download'],
            { CHAIN: 'sepolia' },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stdout, /--chain mainnet/);
    });
}

main();
if (failures === 0) {
    console.log('\nAll tests passed.\n');
    process.exit(0);
}
console.log(`\n${failures} test(s) failed.\n`);
process.exit(1);
