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

test('persists cookie jar across handler restarts for login flow', async () => {
  await withTempRoot(async tempRoot => {
    const fetchMock = async (url, init = {}) => {
      if (String(url).includes('/api/web/misc/current-ip')) {
        return new Response(JSON.stringify({ ip: '127.0.0.1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (String(url).includes('/api/web/login/session/')) {
        return new Response(JSON.stringify({ base_resp: { ret: 0 } }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'set-cookie': 'uuid=uuid123; Path=/; HttpOnly',
          },
        });
      }
      if (String(url).includes('/api/web/login/getqrcode')) {
        const cookieHeader =
          typeof init.headers?.get === 'function' ? init.headers.get('Cookie') || '' : String(init.headers?.Cookie || '');
        if (!cookieHeader.includes('uuid=uuid123')) {
          return new Response('missing uuid cookie', { status: 401 });
        }
        return new Response(Buffer.from([1, 2, 3, 4]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      return new Response('not found', { status: 404 });
    };

    const first = createSkillHandler({
      projectRoot: tempRoot,
      now: () => new Date('2026-03-26T10:00:00Z'),
      fetch: fetchMock,
    });
    const sessionResult = await first({ action: 'session_start', sid: 's1' }, createMockContext());
    assert.equal(sessionResult.ok, true);

    const second = createSkillHandler({
      projectRoot: tempRoot,
      now: () => new Date('2026-03-26T10:00:00Z'),
      fetch: fetchMock,
    });
    const qrResult = await second({ action: 'login_get_qrcode' }, createMockContext());
    assert.equal(qrResult.ok, true);
    assert.equal(qrResult.data.size_bytes, 4);
  });
});

test('add_account_search returns candidate list for account selection', async () => {
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
        if (String(url).includes('/api/public/v1/account')) {
          return new Response(
            JSON.stringify({
              base_resp: { ret: 0, err_msg: 'ok' },
              total: 1,
              list: [
                {
                  fakeid: 'biz-1',
                  nickname: '环球旅讯',
                  alias: 'Traveldaily',
                  service_type: 0,
                  verify_status: 2,
                  signature: '影响行业的力量',
                  round_head_img: 'https://example.com/a.png',
                },
              ],
            }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }
          );
        }
        return new Response('not found', { status: 404 });
      },
    });

    const result = await handler(
      {
        action: 'add_account_search',
        keyword: '环球旅讯',
        begin: 0,
        size: 5,
      },
      createMockContext({ OPENCLAW_AUTH_KEY: 'k1' })
    );

    assert.equal(result.ok, true);
    assert.equal(result.data.total, 1);
    assert.equal(result.data.candidates.length, 1);
    assert.equal(result.data.candidates[0].fakeid, 'biz-1');
  });
});

test('add_account_sync paginates by message count and aggregates articles', async () => {
  await withTempRoot(async tempRoot => {
    const beginCalls = [];
    const handler = createSkillHandler({
      projectRoot: tempRoot,
      fetch: async url => {
        const requestUrl = new URL(String(url));
        if (requestUrl.pathname === '/api/web/misc/current-ip') {
          return new Response(JSON.stringify({ ip: '127.0.0.1' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (requestUrl.pathname === '/api/public/v1/article') {
          const begin = Number(requestUrl.searchParams.get('begin') || '0');
          beginCalls.push(begin);
          if (begin === 0) {
            return new Response(
              JSON.stringify({
                base_resp: { ret: 0, err_msg: 'ok' },
                articles: [
                  { aid: 'a1', itemidx: 1, link: 'https://mp.weixin.qq.com/s/a1' },
                  { aid: 'a2', itemidx: 2, link: 'https://mp.weixin.qq.com/s/a2' },
                  { aid: 'a3', itemidx: 1, link: 'https://mp.weixin.qq.com/s/a3' },
                ],
              }),
              {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }
            );
          }
          if (begin === 2) {
            return new Response(
              JSON.stringify({
                base_resp: { ret: 0, err_msg: 'ok' },
                articles: [{ aid: 'a4', itemidx: 1, link: 'https://mp.weixin.qq.com/s/a4' }],
              }),
              {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }
            );
          }
          return new Response(JSON.stringify({ base_resp: { ret: 0, err_msg: 'ok' }, articles: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    });

    const result = await handler(
      {
        action: 'add_account_sync',
        fakeid: 'biz-1',
        begin: 0,
        size: 2,
        max_pages: 2,
      },
      createMockContext({ OPENCLAW_AUTH_KEY: 'k1' })
    );

    assert.equal(result.ok, true);
    assert.deepEqual(beginCalls, [0, 2]);
    assert.equal(result.data.synced_pages, 2);
    assert.equal(result.data.synced_messages, 3);
    assert.equal(result.data.synced_articles, 4);
    assert.equal(result.data.next_begin, 3);
  });
});
