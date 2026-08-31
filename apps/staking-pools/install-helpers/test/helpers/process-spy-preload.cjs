const cp = require('child_process');

global.__SPAWN_LOG__ = global.__SPAWN_LOG__ || [];

function record(method, args) {
  const raw = String(args[0] ?? '');
  const executable = (raw.split(/[/\\]/).pop() || raw).toLowerCase();
  global.__SPAWN_LOG__.push({ method, executable, argv0: raw });
}

for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile']) {
  const original = cp[method];
  cp[method] = function patchedChildProcessCall(...args) {
    record(method, args);
    return original.apply(this, args);
  };
}
