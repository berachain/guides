#!/usr/bin/env node
/**
 * Tests for fetch-berachain-snapshot-v2.js restore into BEACOND_DATA / RETH_DATA.
 *
 * Run: node apps/node-scripts/test-fetch-berachain-snapshot-v2.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'fetch-berachain-snapshot-v2.js');
const FIXTURE_CATALOG = path.join(__dirname, 'test-fixtures', 'v2-catalog.csv');
const FIXTURE_CATALOG_URL = `file://${FIXTURE_CATALOG}`;
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
echo restored > "$tmp/blockstore.db"
tar -c -C "$tmp" .
rm -rf "$tmp"
`;
}

function passthroughLz4Stub() {
    return '#!/bin/sh\nif [ "$1" = "-d" ]; then cat; else echo "unexpected lz4 args: $*" >&2; exit 1; fi\n';
}

function rethStub(body) {
    return `#!/bin/sh
if [ "$1" = "download" ] && [ "$2" = "--help" ]; then
  echo "Usage: bera-reth download"
  echo "      --manifest-url <URL>"
  echo "      --minimal"
  echo "      --archive"
  exit 0
fi
${body}
`;
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
        fs.writeFileSync(path.join(dir, name), body, { mode: 0o755 });
    }
    return dir;
}

function makeHomes(tmp) {
    const beacond = path.join(tmp, 'beacond');
    const reth = path.join(tmp, 'reth', 'data');
    fs.mkdirSync(path.join(beacond, 'config'), { recursive: true });
    fs.mkdirSync(path.join(beacond, 'data'), { recursive: true });
    fs.mkdirSync(reth, { recursive: true });
    fs.writeFileSync(path.join(beacond, 'config', 'priv_validator_key.json'), 'operator-key');
    fs.writeFileSync(path.join(beacond, 'config', 'jwt.hex'), 'jwt-secret');
    return { beacond, reth };
}

function destFlags(beacond, reth) {
    const flags = ['--beacond-data', beacond];
    if (reth) {
        flags.push('--reth-data', reth);
    }
    return flags;
}

function main() {
    console.log('\nfetch-berachain-snapshot-v2 restore tests\n');

    test('--beacon-only and --el-only are mutually exclusive', () => {
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

    test('--type pruned selects el-manifest, --minimal, and cl-pruned', () => {
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

    test('--type archive selects el-manifest, --archive, and cl-pruned', () => {
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

    test('--full-cl selects cl-archive regardless of --type', () => {
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

    test('missing catalog exits non-zero with a generic error', () => {
        const missing = `file://${path.join(makeTempDir('snapv2-missing-'), 'missing.csv')}`;
        const result = runScript(['--network', 'bepolia', '--catalog-url', missing, '--no-download']);
        assert.notStrictEqual(result.status, 0);
        assert.match(result.stderr, /catalog|ENOENT|no such file/i);
        assert.doesNotMatch(result.stderr, /fetch-berachain-snapshot\.js/);
    });

    test('mainnet missing catalog is the same generic error, not a v1 fallback', () => {
        const missing = `file://${path.join(makeTempDir('snapv2-mainnet-'), 'missing.csv')}`;
        const result = runScript(['--network', 'mainnet', '--catalog-url', missing, '--no-download']);
        assert.notStrictEqual(result.status, 0);
        assert.match(result.stderr, /catalog|ENOENT|no such file/i);
        assert.doesNotMatch(result.stderr, /fetch-berachain-snapshot\.js/);
        assert.doesNotMatch(result.stderr, /index\.csv/);
    });

    test('missing required role exits non-zero', () => {
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

    test('extract without BEACOND_DATA fails closed', () => {
        const result = runScript([
            '--network',
            'bepolia',
            '--beacon-only',
            '--catalog-url',
            FIXTURE_CATALOG_URL,
        ]);
        assert.notStrictEqual(result.status, 0);
        assert.match(result.stderr, /BEACOND_DATA/);
    });

    test('dirty reth datadir without --force fails closed', () => {
        const tmp = makeTempDir('snapv2-dirty-');
        const { beacond, reth } = makeHomes(tmp);
        fs.writeFileSync(path.join(reth, 'unexpected.bin'), 'x');
        const bin = writeStubBin(restoreStubs({ 'bera-reth': rethStub('exit 0') }));
        const result = runScript(
            [
                '--network',
                'bepolia',
                '--catalog-url',
                FIXTURE_CATALOG_URL,
                '--reth-bin',
                path.join(bin, 'bera-reth'),
                ...destFlags(beacond, reth),
            ],
            { PATH: `${bin}:${process.env.PATH}` },
        );
        assert.notStrictEqual(result.status, 0);
        assert.match(result.stderr, /unexpected/i);
    });

    test('setup-reth init datadir is replaced without --force', () => {
        const tmp = makeTempDir('snapv2-init-');
        const { beacond, reth } = makeHomes(tmp);
        fs.mkdirSync(path.join(reth, 'db'));
        fs.mkdirSync(path.join(reth, 'static_files'));
        fs.writeFileSync(path.join(reth, 'db', 'mdbx.dat'), 'init');
        const rethLog = path.join(tmp, 'reth.log');
        const bin = writeStubBin(
            restoreStubs({
                'bera-reth': rethStub(`echo "$@" >> "${rethLog}"
echo el > "${reth}/restored.txt"
exit 0`),
            }),
        );
        const result = runScript(
            [
                '--network',
                'bepolia',
                '--catalog-url',
                FIXTURE_CATALOG_URL,
                '--reth-bin',
                path.join(bin, 'bera-reth'),
                ...destFlags(beacond, reth),
            ],
            { PATH: `${bin}:${process.env.PATH}` },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        assert.ok(!fs.existsSync(path.join(reth, 'db', 'mdbx.dat')));
        assert.strictEqual(fs.readFileSync(path.join(reth, 'restored.txt'), 'utf8').trim(), 'el');
    });

    test('--no-download prints restore commands and does not invoke curl', () => {
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
        assert.ok(!fs.existsSync(curlLog), 'curl must not run in --no-download mode');
    });

    test('missing bera-reth fails closed when EL restore is requested', () => {
        const tmp = makeTempDir('snapv2-noreth-');
        const { beacond, reth } = makeHomes(tmp);
        const bin = writeStubBin(restoreStubs());
        const result = runScript(
            [
                '--network',
                'bepolia',
                '--catalog-url',
                FIXTURE_CATALOG_URL,
                ...destFlags(beacond, reth),
            ],
            { PATH: `${bin}:${process.env.PATH}` },
        );
        assert.notStrictEqual(result.status, 0);
        assert.match(result.stderr, /bera-reth not found/i);
        assert.ok(!fs.existsSync(path.join(beacond, 'data', 'blockstore.db')));
    });

    test('bera-reth without --manifest-url fails closed', () => {
        const tmp = makeTempDir('snapv2-oldreth-');
        const { beacond, reth } = makeHomes(tmp);
        const bin = writeStubBin(
            restoreStubs({
                'bera-reth': `#!/bin/sh
if [ "$1" = "download" ] && [ "$2" = "--help" ]; then
  echo "Usage: bera-reth download"
  echo "  -u, --url <URL>"
  exit 0
fi
exit 0
`,
            }),
        );
        const result = runScript(
            [
                '--network',
                'bepolia',
                '--catalog-url',
                FIXTURE_CATALOG_URL,
                '--reth-bin',
                path.join(bin, 'bera-reth'),
                ...destFlags(beacond, reth),
            ],
            { PATH: `${bin}:${process.env.PATH}` },
        );
        assert.notStrictEqual(result.status, 0);
        assert.match(result.stderr, /--manifest-url/);
    });

    test('bera-reth stub receives manifest-url, datadir, and --minimal', () => {
        const tmp = makeTempDir('snapv2-argv-');
        const { beacond, reth } = makeHomes(tmp);
        const rethLog = path.join(tmp, 'reth.log');
        const bin = writeStubBin(
            restoreStubs({
                'bera-reth': rethStub(`echo "$@" >> "${rethLog}"
echo el > "${reth}/restored.txt"
exit 0`),
            }),
        );
        const result = runScript(
            [
                '--network',
                'bepolia',
                '--catalog-url',
                FIXTURE_CATALOG_URL,
                '--reth-bin',
                path.join(bin, 'bera-reth'),
                ...destFlags(beacond, reth),
            ],
            { PATH: `${bin}:${process.env.PATH}` },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        const argv = fs.readFileSync(rethLog, 'utf8');
        assert.match(argv, /--manifest-url/);
        assert.match(argv, /manifest\.json/);
        assert.match(argv, new RegExp(`--datadir ${reth.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
        assert.match(argv, /--minimal/);
    });

    test('CL extract lands in BEACOND_DATA/data and preserves keys', () => {
        const tmp = makeTempDir('snapv2-cl-');
        const { beacond, reth } = makeHomes(tmp);
        const curlLog = path.join(tmp, 'curl.log');
        const bin = writeStubBin(
            restoreStubs({
                curl: `#!/bin/sh\necho "$*" >> "${curlLog}"\n${clPayloadStub().replace('#!/bin/sh\n', '')}`,
                'bera-reth': rethStub('exit 0'),
            }),
        );
        const result = runScript(
            [
                '--network',
                'bepolia',
                '--catalog-url',
                FIXTURE_CATALOG_URL,
                '--reth-bin',
                path.join(bin, 'bera-reth'),
                ...destFlags(beacond, reth),
            ],
            { PATH: `${bin}:${process.env.PATH}` },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        const curlArgs = fs.readFileSync(curlLog, 'utf8');
        assert.match(curlArgs, /beacon-kit-pruned-22980000\.tar\.lz4/);
        assert.strictEqual(
            fs.readFileSync(path.join(beacond, 'data', 'blockstore.db'), 'utf8').trim(),
            'restored',
        );
        assert.strictEqual(
            fs.readFileSync(path.join(beacond, 'config', 'priv_validator_key.json'), 'utf8'),
            'operator-key',
        );
        assert.ok(fs.existsSync(path.join(beacond, 'data', 'priv_validator_state.json')));
        assert.ok(!fs.existsSync(path.join(tmp, 'bepolia-pruned-cl')));
        assert.ok(!fs.existsSync(path.join(tmp, 'bepolia-pruned-el')));
    });

    test('existing priv_validator_state.json is kept without --force', () => {
        const tmp = makeTempDir('snapv2-statekeep-');
        const { beacond, reth } = makeHomes(tmp);
        fs.writeFileSync(path.join(beacond, 'data', 'priv_validator_state.json'), '{"height":"0"}');
        const bin = writeStubBin(
            restoreStubs({
                'bera-reth': rethStub('exit 0'),
            }),
        );
        const result = runScript(
            [
                '--network',
                'bepolia',
                '--catalog-url',
                FIXTURE_CATALOG_URL,
                '--reth-bin',
                path.join(bin, 'bera-reth'),
                ...destFlags(beacond, reth),
            ],
            { PATH: `${bin}:${process.env.PATH}` },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        assert.strictEqual(
            fs.readFileSync(path.join(beacond, 'data', 'priv_validator_state.json'), 'utf8'),
            '{"height":"0"}',
        );
    });

    test('CHAIN env var sets the default network', () => {
        const result = runScript(['--catalog-url', FIXTURE_CATALOG_URL, '--no-download'], {
            CHAIN: 'bepolia',
        });
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stdout, /--chain bepolia/);
    });

    test('--network still overrides CHAIN when both are set', () => {
        const result = runScript(
            ['--network', 'bepolia', '--catalog-url', FIXTURE_CATALOG_URL, '--no-download'],
            { CHAIN: 'mainnet' },
        );
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stdout, /--chain bepolia/);
    });

    test('an invalid CHAIN value is ignored, falling back to mainnet catalog shape', () => {
        const result = runScript(['--catalog-url', FIXTURE_CATALOG_URL, '--no-download'], {
            CHAIN: 'sepolia',
        });
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stdout, /Network: mainnet/);
        assert.match(result.stdout, /--chain mainnet/);
    });

    test('mainnet uses the same catalog URL shape as bepolia', () => {
        const result = runScript(['--network', 'mainnet', '--help']);
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(
            result.stdout,
            /https:\/\/bera-snapshots\.fsn1\.your-objectstorage\.com\/v2\/mainnet\/catalog\.csv/,
        );
        assert.match(
            result.stdout,
            /https:\/\/bera-snapshots\.fsn1\.your-objectstorage\.com\/v2\/bepolia\/catalog\.csv/,
        );
    });
}

main();
if (failures === 0) {
    console.log('\nAll tests passed.\n');
    process.exit(0);
}
console.log(`\n${failures} test(s) failed.\n`);
process.exit(1);
