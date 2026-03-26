const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createSkillHandler } = require('../src/skill-core.cjs');

function createMockContext(config = {}) {
  return {
    config,
    logger: {
      info() {},
      warn() {},
    },
  };
}

async function withTempRoot(fn) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-skill-'));
  try {
    await fn(tempRoot);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

test('returns validation error for invalid inputs', async () => {
  await withTempRoot(async tempRoot => {
    const handler = createSkillHandler({
      projectRoot: tempRoot,
      fetch: async () => new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } }),
    });

    const result = await handler({ action: 'search_account' }, createMockContext({ OPENCLAW_AUTH_KEY: 'abc' }));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'INVALID_INPUT');
  });
});

test('returns missing auth key for protected actions', async () => {
  await withTempRoot(async tempRoot => {
    const handler = createSkillHandler({
      projectRoot: tempRoot,
      fetch: async () => new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } }),
    });

    const result = await handler(
      {
        action: 'search_account',
        keyword: 'test',
      },
      createMockContext()
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'MISSING_AUTH_KEY');
  });
});

test('download_article writes file and returns metadata', async () => {
  await withTempRoot(async tempRoot => {
    const handler = createSkillHandler({
      projectRoot: tempRoot,
      now: () => new Date('2026-03-26T10:00:00Z'),
      fetch: async url => {
        if (String(url).includes('/api/web/misc/current-ip')) {
          return new Response(JSON.stringify({ ip: '127.0.0.1' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (String(url).includes('/api/public/v1/download')) {
          return new Response('<html>ok</html>', {
            status: 200,
            headers: { 'content-type': 'text/html; charset=UTF-8' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    });

    const result = await handler(
      {
        action: 'download_article',
        url: 'https://mp.weixin.qq.com/s/abc',
        format: 'html',
      },
      createMockContext()
    );

    assert.equal(result.ok, true);
    assert.equal(result.data.format, 'html');
    assert.ok(result.data.absolute_path.endsWith('.html'));
    const fileContent = await fs.readFile(result.data.absolute_path, 'utf8');
    assert.equal(fileContent, '<html>ok</html>');
  });
});

test('login_finalize captures auth-key from set-cookie', async () => {
  await withTempRoot(async tempRoot => {
    const handler = createSkillHandler({
      projectRoot: tempRoot,
      fetch: async url => {
        if (String(url).includes('/api/web/misc/current-ip')) {
          return new Response(JSON.stringify({ ip: '127.0.0.1' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (String(url).includes('/api/web/login/bizlogin')) {
          return new Response(JSON.stringify({ nickname: 'x', avatar: 'y' }), {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'set-cookie': 'auth-key=abc123; Path=/; HttpOnly',
            },
          });
        }
        return new Response('not found', { status: 404 });
      },
    });

    const result = await handler({ action: 'login_finalize' }, createMockContext());
    assert.equal(result.ok, true);
    assert.equal(result.data.auth_key, 'abc123');
    const stateRaw = await fs.readFile(path.join(tempRoot, '.data/openclaw-skill/state.json'), 'utf8');
    const state = JSON.parse(stateRaw);
    assert.equal(state.authKey, 'abc123');
  });
});

test('uses persisted auth key automatically for protected action', async () => {
  await withTempRoot(async tempRoot => {
    await fs.mkdir(path.join(tempRoot, '.data/openclaw-skill'), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, '.data/openclaw-skill/state.json'),
      JSON.stringify({ authKey: 'persisted-key' }, null, 2),
      'utf8'
    );

    const handler = createSkillHandler({
      projectRoot: tempRoot,
      fetch: async url => {
        if (String(url).includes('/api/web/misc/current-ip')) {
          return new Response(JSON.stringify({ ip: '127.0.0.1' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (String(url).includes('/api/public/v1/authkey')) {
          return new Response(JSON.stringify({ code: 0, data: 'persisted-key' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    });

    const result = await handler({ action: 'authkey_validate' }, createMockContext());
    assert.equal(result.ok, true);
    assert.equal(result.data.response.data, 'persisted-key');
  });
});
