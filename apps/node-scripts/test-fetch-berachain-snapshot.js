#!/usr/bin/env node
/**
 * Tests for fetch-berachain-snapshot.js restore flow.
 *
 * Run: node apps/node-scripts/test-fetch-berachain-snapshot.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'fetch-berachain-snapshot.js');
const SYSTEM_TAR =
    spawnSync('sh', ['-c', 'command -v tar'], { encoding: 'utf8' }).stdout.trim() || '/usr/bin/tar';
const SYSTEM_LZ4 = spawnSync('sh', ['-c', 'command -v lz4'], { encoding: 'utf8' }).stdout.trim();

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

function writeIndex(dir, rows) {
    const header = 'type,url,url_s3,created_at';
    const body = rows
        .map((row) => `${row.type},${row.url},${row.url_s3 || ''},${row.created_at}`)
        .join('\n');
    const filePath = path.join(dir, 'index.csv');
    fs.writeFileSync(filePath, `${header}\n${body}\n`);
    return `file://${filePath}`;
}

function defaultRows(baseUrl) {
    return [
        {
            type: 'beacon-kit-pruned',
            url: `${baseUrl}/beacon-kit-pruned-100.tar.lz4`,
            created_at: '2026-01-02T00:00:00Z',
        },
        {
            type: 'reth-pruned',
            url: `${baseUrl}/reth-pruned-100.tar.lz4`,
            created_at: '2026-01-02T00:00:00Z',
        },
        {
            type: 'beacon-kit-archive',
            url: `${baseUrl}/beacon-kit-archive-100.tar.lz4`,
            created_at: '2026-01-02T00:00:00Z',
        },
        {
            type: 'reth-archive',
            url: `${baseUrl}/reth-archive-100.tar.lz4`,
            created_at: '2026-01-02T00:00:00Z',
        },
    ];
}

function writeStubBin(stubs) {
    const dir = makeTempDir('snapv1-bin-');
    for (const [name, body] of Object.entries(stubs)) {
        fs.writeFileSync(path.join(dir, name), body, { mode: 0o755 });
    }
    return dir;
}

function makeLz4Tar(destArchive, entries, { prefix = '' } = {}) {
    if (!SYSTEM_LZ4) {
        throw new Error('lz4 is required to build test fixtures');
    }
    const staging = makeTempDir('snapv1-tar-');
    for (const [rel, contents] of Object.entries(entries)) {
        const full = path.join(staging, prefix, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, contents);
    }
    const tarRoot = prefix ? staging : staging;
    const packed = spawnSync(
        'sh',
        ['-c', `${SYSTEM_TAR} -c -C ${JSON.stringify(tarRoot)} . | ${SYSTEM_LZ4} -c > ${JSON.stringify(destArchive)}`],
        { encoding: 'utf8' },
    );
    if (packed.status !== 0) {
        throw new Error(packed.stderr || 'failed to build lz4 tar fixture');
    }
}

function curlCopiesFixtures(fixtureDir) {
    return `#!/bin/sh
out=""
url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -C) shift 2 ;;
    -L|-s|-f|-k) shift ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
name=$(basename "$url")
src="${fixtureDir}/$name"
if [ ! -f "$src" ]; then echo "missing fixture $src" >&2; exit 1; fi
mkdir -p "$(dirname "$out")"
cp "$src" "$out"
`;
}

function main() {
    console.log('\nfetch-berachain-snapshot restore tests\n');

    test('--beacon-only and --el-only are mutually exclusive', () => {
        const result = runScript(['--beacon-only', '--el-only', '--no-extract']);
        assert.notStrictEqual(result.status, 0);
        assert.match(result.stderr, /beacon-only.*execution-only|execution-only.*beacon-only/i);
    });

    test('--type pruned selects beacon-kit-pruned and reth-pruned', () => {
        const tmp = makeTempDir('snapv1-idx-');
        const fixtureDir = path.join(tmp, 'files');
        fs.mkdirSync(fixtureDir);
        fs.writeFileSync(path.join(fixtureDir, 'beacon-kit-pruned-100.tar.lz4'), 'x');
        fs.writeFileSync(path.join(fixtureDir, 'reth-pruned-100.tar.lz4'), 'x');
        const indexUrl = writeIndex(tmp, defaultRows(`file://${fixtureDir}`));
        const bin = writeStubBin({ curl: curlCopiesFixtures(fixtureDir) });
        const result = runScript(
            ['--type', 'pruned', '--index-url', indexUrl, '--no-extract', '-o', path.join(tmp, 'downloads')],
            { PATH: `${bin}:${process.env.PATH}` },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stdout, /beacon-kit-pruned-100\.tar\.lz4/);
        assert.match(result.stdout, /reth-pruned-100\.tar\.lz4/);
        assert.doesNotMatch(result.stdout, /archive-100/);
    });

    test('--type archive selects archive rows, not pruned', () => {
        const tmp = makeTempDir('snapv1-idx-');
        const fixtureDir = path.join(tmp, 'files');
        fs.mkdirSync(fixtureDir);
        fs.writeFileSync(path.join(fixtureDir, 'beacon-kit-archive-100.tar.lz4'), 'x');
        fs.writeFileSync(path.join(fixtureDir, 'reth-archive-100.tar.lz4'), 'x');
        const indexUrl = writeIndex(tmp, defaultRows(`file://${fixtureDir}`));
        const bin = writeStubBin({ curl: curlCopiesFixtures(fixtureDir) });
        const result = runScript(
            ['--type', 'archive', '--index-url', indexUrl, '--no-extract', '-o', path.join(tmp, 'downloads')],
            { PATH: `${bin}:${process.env.PATH}` },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stdout, /beacon-kit-archive-100\.tar\.lz4/);
        assert.match(result.stdout, /reth-archive-100\.tar\.lz4/);
        assert.doesNotMatch(result.stdout, /pruned-100/);
    });

    test('CHAIN env var sets the default network', () => {
        const tmp = makeTempDir('snapv1-chain-');
        const fixtureDir = path.join(tmp, 'files');
        fs.mkdirSync(fixtureDir);
        fs.writeFileSync(path.join(fixtureDir, 'beacon-kit-pruned-100.tar.lz4'), 'x');
        fs.writeFileSync(path.join(fixtureDir, 'reth-pruned-100.tar.lz4'), 'x');
        const indexUrl = writeIndex(tmp, defaultRows(`file://${fixtureDir}`));
        const bin = writeStubBin({ curl: curlCopiesFixtures(fixtureDir) });
        const result = runScript(
            ['--index-url', indexUrl, '--no-extract', '--beacon-only', '-o', path.join(tmp, 'downloads')],
            { PATH: `${bin}:${process.env.PATH}`, CHAIN: 'bepolia' },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stdout, /Network: bepolia/);
    });

    test('--network overrides CHAIN', () => {
        const tmp = makeTempDir('snapv1-net-');
        const fixtureDir = path.join(tmp, 'files');
        fs.mkdirSync(fixtureDir);
        fs.writeFileSync(path.join(fixtureDir, 'beacon-kit-pruned-100.tar.lz4'), 'x');
        const indexUrl = writeIndex(tmp, defaultRows(`file://${fixtureDir}`));
        const bin = writeStubBin({ curl: curlCopiesFixtures(fixtureDir) });
        const result = runScript(
            [
                '--network',
                'mainnet',
                '--index-url',
                indexUrl,
                '--no-extract',
                '--beacon-only',
                '-o',
                path.join(tmp, 'downloads'),
            ],
            { PATH: `${bin}:${process.env.PATH}`, CHAIN: 'bepolia' },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stdout, /Network: mainnet/);
    });

    test('missing required snapshot exits non-zero', () => {
        const tmp = makeTempDir('snapv1-miss-');
        const indexUrl = writeIndex(tmp, [
            {
                type: 'reth-pruned',
                url: 'https://example.test/reth-pruned-100.tar.lz4',
                created_at: '2026-01-02T00:00:00Z',
            },
        ]);
        const result = runScript(['--index-url', indexUrl, '--beacon-only', '--no-extract']);
        assert.notStrictEqual(result.status, 0);
        assert.match(result.stderr, /beacon-kit-pruned/);
    });

    test('extract without BEACOND_DATA fails closed', () => {
        const result = runScript(['--beacon-only']);
        assert.notStrictEqual(result.status, 0);
        assert.match(result.stderr, /BEACOND_DATA/);
    });

    test('dirty reth datadir without --force fails closed', () => {
        const tmp = makeTempDir('snapv1-dirty-');
        const fixtureDir = path.join(tmp, 'files');
        fs.mkdirSync(fixtureDir);
        const archive = path.join(fixtureDir, 'reth-pruned-100.tar.lz4');
        makeLz4Tar(archive, { 'db/mdbx.dat': 'snapshot-db' });
        const indexUrl = writeIndex(tmp, defaultRows(`file://${fixtureDir}`));
        const rethData = path.join(tmp, 'reth');
        fs.mkdirSync(rethData);
        fs.writeFileSync(path.join(rethData, 'unexpected.txt'), 'nope');
        const bin = writeStubBin({ curl: curlCopiesFixtures(fixtureDir) });
        const result = runScript(
            [
                '--el-only',
                '--index-url',
                indexUrl,
                '--reth-data',
                rethData,
                '-o',
                path.join(tmp, 'downloads'),
            ],
            { PATH: `${bin}:${process.env.PATH}` },
        );
        assert.notStrictEqual(result.status, 0);
        assert.match(result.stderr, /--force/);
        assert.ok(fs.existsSync(path.join(rethData, 'unexpected.txt')));
    });

    test('setup-reth init datadir is replaced without --force', () => {
        const tmp = makeTempDir('snapv1-init-');
        const fixtureDir = path.join(tmp, 'files');
        fs.mkdirSync(fixtureDir);
        const archive = path.join(fixtureDir, 'reth-pruned-100.tar.lz4');
        makeLz4Tar(archive, { 'db/mdbx.dat': 'snapshot-db', 'rocksdb/IDENTITY': 'id' });
        const indexUrl = writeIndex(tmp, defaultRows(`file://${fixtureDir}`));
        const rethData = path.join(tmp, 'reth');
        fs.mkdirSync(path.join(rethData, 'db'), { recursive: true });
        fs.writeFileSync(path.join(rethData, 'db', 'mdbx.dat'), 'init');
        fs.writeFileSync(path.join(rethData, 'reth.toml'), 'init-toml');
        const bin = writeStubBin({ curl: curlCopiesFixtures(fixtureDir) });
        const result = runScript(
            [
                '--el-only',
                '--index-url',
                indexUrl,
                '--reth-data',
                rethData,
                '-o',
                path.join(tmp, 'downloads'),
            ],
            { PATH: `${bin}:${process.env.PATH}` },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        assert.strictEqual(fs.readFileSync(path.join(rethData, 'db', 'mdbx.dat'), 'utf8'), 'snapshot-db');
        assert.ok(fs.existsSync(path.join(rethData, 'rocksdb', 'IDENTITY')));
    });

    test('flat CL tarball extracts into BEACOND_DATA/data and preserves keys', () => {
        const tmp = makeTempDir('snapv1-cl-');
        const fixtureDir = path.join(tmp, 'files');
        fs.mkdirSync(fixtureDir);
        const archive = path.join(fixtureDir, 'beacon-kit-pruned-100.tar.lz4');
        makeLz4Tar(archive, {
            'blockstore.db/block.db': 'blocks',
            'config/priv_validator_key.json': 'attacker-key',
        });
        const indexUrl = writeIndex(tmp, defaultRows(`file://${fixtureDir}`));
        const home = path.join(tmp, 'beacond');
        fs.mkdirSync(path.join(home, 'config'), { recursive: true });
        fs.writeFileSync(path.join(home, 'config', 'priv_validator_key.json'), 'operator-key');
        fs.writeFileSync(path.join(home, 'config', 'jwt.hex'), 'jwt-secret');
        const bin = writeStubBin({ curl: curlCopiesFixtures(fixtureDir) });
        const result = runScript(
            [
                '--beacon-only',
                '--index-url',
                indexUrl,
                '--beacond-data',
                home,
                '-o',
                path.join(tmp, 'downloads'),
            ],
            { PATH: `${bin}:${process.env.PATH}` },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        assert.strictEqual(
            fs.readFileSync(path.join(home, 'config', 'priv_validator_key.json'), 'utf8'),
            'operator-key',
        );
        assert.strictEqual(fs.readFileSync(path.join(home, 'config', 'jwt.hex'), 'utf8'), 'jwt-secret');
        assert.strictEqual(
            fs.readFileSync(path.join(home, 'data', 'blockstore.db', 'block.db'), 'utf8'),
            'blocks',
        );
        assert.ok(fs.existsSync(path.join(home, 'data', 'priv_validator_state.json')));
    });

    test('existing priv_validator_state.json is kept without --force', () => {
        const tmp = makeTempDir('snapv1-statekeep-');
        const fixtureDir = path.join(tmp, 'files');
        fs.mkdirSync(fixtureDir);
        const archive = path.join(fixtureDir, 'beacon-kit-pruned-100.tar.lz4');
        makeLz4Tar(archive, { 'blockstore.db/block.db': 'blocks' });
        const indexUrl = writeIndex(tmp, defaultRows(`file://${fixtureDir}`));
        const home = path.join(tmp, 'beacond');
        fs.mkdirSync(path.join(home, 'config'), { recursive: true });
        fs.mkdirSync(path.join(home, 'data'), { recursive: true });
        fs.writeFileSync(path.join(home, 'config', 'priv_validator_key.json'), 'operator-key');
        fs.writeFileSync(path.join(home, 'data', 'priv_validator_state.json'), '{"height":"0"}');
        const bin = writeStubBin({ curl: curlCopiesFixtures(fixtureDir) });
        const result = runScript(
            [
                '--beacon-only',
                '--index-url',
                indexUrl,
                '--beacond-data',
                home,
                '-o',
                path.join(tmp, 'downloads'),
            ],
            { PATH: `${bin}:${process.env.PATH}` },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        assert.strictEqual(
            fs.readFileSync(path.join(home, 'data', 'priv_validator_state.json'), 'utf8'),
            '{"height":"0"}',
        );
        assert.strictEqual(
            fs.readFileSync(path.join(home, 'data', 'blockstore.db', 'block.db'), 'utf8'),
            'blocks',
        );
    });

    test('data/-prefixed CL tarball extracts into BEACOND_DATA', () => {
        const tmp = makeTempDir('snapv1-prefix-');
        const fixtureDir = path.join(tmp, 'files');
        fs.mkdirSync(fixtureDir);
        const archive = path.join(fixtureDir, 'beacon-kit-pruned-100.tar.lz4');
        makeLz4Tar(archive, { 'data/application.db/state': 'app' });
        const indexUrl = writeIndex(tmp, defaultRows(`file://${fixtureDir}`));
        const home = path.join(tmp, 'beacond');
        fs.mkdirSync(path.join(home, 'config'), { recursive: true });
        fs.writeFileSync(path.join(home, 'config', 'priv_validator_key.json'), 'operator-key');
        const bin = writeStubBin({ curl: curlCopiesFixtures(fixtureDir) });
        const result = runScript(
            [
                '--beacon-only',
                '--index-url',
                indexUrl,
                '--beacond-data',
                home,
                '-o',
                path.join(tmp, 'downloads'),
            ],
            { PATH: `${bin}:${process.env.PATH}` },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        assert.strictEqual(
            fs.readFileSync(path.join(home, 'data', 'application.db', 'state'), 'utf8'),
            'app',
        );
        assert.strictEqual(
            fs.readFileSync(path.join(home, 'config', 'priv_validator_key.json'), 'utf8'),
            'operator-key',
        );
    });

    test('--no-extract downloads and does not write datadirs', () => {
        const tmp = makeTempDir('snapv1-noex-');
        const fixtureDir = path.join(tmp, 'files');
        fs.mkdirSync(fixtureDir);
        const archive = path.join(fixtureDir, 'reth-pruned-100.tar.lz4');
        makeLz4Tar(archive, { 'db/mdbx.dat': 'snapshot-db' });
        const indexUrl = writeIndex(tmp, defaultRows(`file://${fixtureDir}`));
        const rethData = path.join(tmp, 'reth');
        fs.mkdirSync(rethData);
        const bin = writeStubBin({ curl: curlCopiesFixtures(fixtureDir) });
        const result = runScript(
            [
                '--el-only',
                '--index-url',
                indexUrl,
                '--reth-data',
                rethData,
                '--no-extract',
                '-o',
                path.join(tmp, 'downloads'),
            ],
            { PATH: `${bin}:${process.env.PATH}` },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stdout, /lz4 -dc .* \| tar -x -C/);
        assert.strictEqual(fs.readdirSync(rethData).length, 0);
        assert.ok(fs.existsSync(path.join(tmp, 'downloads', 'reth-pruned-100.tar.lz4')));
    });
}

main();
if (failures === 0) {
    console.log('\nAll tests passed.\n');
    process.exit(0);
}
console.log(`\n${failures} test(s) failed.\n`);
process.exit(1);
