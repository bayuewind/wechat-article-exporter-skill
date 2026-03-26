#!/usr/bin/env node
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const BOOTSTRAP_SCRIPT = path.join(__dirname, 'bootstrap.sh');
const CORE_MODULE = path.join(ROOT_DIR, 'openclaw-skill/src/skill-core.cjs');

function print(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function parseInput(argv) {
  const args = argv.slice(2);
  const jsonIdx = args.findIndex(item => item === '--json');
  if (jsonIdx >= 0) {
    const payload = args[jsonIdx + 1] || '';
    return JSON.parse(payload);
  }

  const first = args[0] || '';
  if (first && (first.startsWith('{') || first.startsWith('['))) {
    return JSON.parse(first);
  }

  if (!process.stdin.isTTY) {
    const chunk = fs.readFileSync(0, 'utf8').trim();
    if (chunk) {
      return JSON.parse(chunk);
    }
  }

  throw new Error('missing input json: use --json \'{\"action\":\"...\"}\'');
}

function maybeBootstrap() {
  if (process.env.WECHAT_SKILL_SKIP_BOOTSTRAP === '1') {
    return;
  }
  if (!fs.existsSync(BOOTSTRAP_SCRIPT)) {
    throw new Error(`bootstrap script not found: ${BOOTSTRAP_SCRIPT}`);
  }
  const result = spawnSync('bash', [BOOTSTRAP_SCRIPT, '--quiet'], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`bootstrap failed with exit code ${result.status}`);
  }
}

async function main() {
  try {
    maybeBootstrap();

    if (!fs.existsSync(CORE_MODULE)) {
      throw new Error(`skill core not found: ${CORE_MODULE}`);
    }

    const { createSkillHandler } = require(CORE_MODULE);
    const handler = createSkillHandler({ projectRoot: ROOT_DIR });
    const input = parseInput(process.argv);
    const context = {
      config: {
        NITRO_BASE_URL: process.env.NITRO_BASE_URL || 'http://127.0.0.1:3000',
        NITRO_BOOT_MODE: process.env.NITRO_BOOT_MODE || 'embedded',
        OPENCLAW_AUTH_KEY: process.env.OPENCLAW_AUTH_KEY || '',
        NITRO_START_COMMAND: process.env.NITRO_START_COMMAND || '',
      },
      logger: {
        info: msg => process.stderr.write(`[skill] ${msg}\n`),
        warn: msg => process.stderr.write(`[skill-warn] ${msg}\n`),
      },
    };

    const output = await handler(input, context);
    print(output);
  } catch (error) {
    print({
      ok: false,
      error: {
        code: 'WRAPPER_ERROR',
        message: error?.message || String(error),
      },
    });
    process.exitCode = 1;
  }
}

main();
