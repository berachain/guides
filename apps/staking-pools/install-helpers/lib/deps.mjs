import { spawnSync } from 'node:child_process';
import { FORBIDDEN_SHELL_COMMANDS } from './constants.mjs';

const REQUIRED_TOOLS = [
  { name: 'node', install: 'Install Node.js 18+ (22 recommended).' },
  { name: 'cast', install: 'Install Foundry: https://book.getfoundry.sh/' },
  { name: 'beacond', install: 'Install beacond or set BEACOND_BIN.' },
];

export function findExecutable(name, env = process.env) {
  if (name === 'beacond') {
    const configured = env.BEACOND_BIN?.trim() || 'beacond';
    if (configured.startsWith('/')) {
      const stat = spawnSync('test', ['-x', configured], {
        encoding: 'utf8',
        shell: true,
      });
      return stat.status === 0 ? configured : '';
    }
    const which = spawnSync('command', ['-v', configured], {
      encoding: 'utf8',
      shell: true,
    });
    return which.status === 0 ? which.stdout.trim() : '';
  }
  const which = spawnSync('command', ['-v', name], {
    encoding: 'utf8',
    shell: true,
  });
  return which.status === 0 ? which.stdout.trim() : '';
}

export function checkDependencies(env = process.env) {
  const missing = [];
  for (const tool of REQUIRED_TOOLS) {
    const resolved = findExecutable(tool.name, env);
    if (!resolved) {
      missing.push({ ...tool, resolved: '' });
    }
  }
  return missing;
}

export function formatMissingDependency(missingTool) {
  return `${missingTool.name} is required. ${missingTool.install}`;
}

export function assertNoForbiddenCommands(argv) {
  const executable = String(argv[0] ?? '').toLowerCase();
  if (FORBIDDEN_SHELL_COMMANDS.includes(executable)) {
    throw new Error(`Forbidden dependency invoked: ${executable}`);
  }
}
