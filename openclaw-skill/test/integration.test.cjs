const assert = require('node:assert/strict');
const test = require('node:test');

const { createSkillHandler } = require('../src/skill-core.cjs');

const enabled = process.env.OPENCLAW_INTEGRATION === '1';
const maybeTest = enabled ? test : test.skip;

function createContext() {
  return {
    config: {
      NITRO_BASE_URL: process.env.NITRO_BASE_URL || 'http://127.0.0.1:3000',
      NITRO_BOOT_MODE: process.env.NITRO_BOOT_MODE || 'external',
      OPENCLAW_AUTH_KEY: process.env.OPENCLAW_AUTH_KEY || '',
    },
    logger: {
      info() {},
      warn() {},
    },
  };
}

maybeTest('main flow: authkey_validate -> search_account -> list_articles -> download_article', async t => {
  const handler = createSkillHandler();
  const ctx = createContext();

  if (!ctx.config.OPENCLAW_AUTH_KEY) {
    t.skip('Missing OPENCLAW_AUTH_KEY');
    return;
  }

  const auth = await handler({ action: 'authkey_validate' }, ctx);
  assert.equal(auth.ok, true);

  const search = await handler(
    {
      action: 'search_account',
      keyword: process.env.OPENCLAW_TEST_KEYWORD || '人民日报',
      begin: 0,
      size: 5,
    },
    ctx
  );
  assert.equal(search.ok, true);

  const first = search.data?.response?.list?.[0];
  assert.ok(first?.fakeid, 'search_account should return at least one fakeid');

  const list = await handler(
    {
      action: 'list_articles',
      fakeid: first.fakeid,
      begin: 0,
      size: 5,
    },
    ctx
  );
  assert.equal(list.ok, true);

  const article = list.data?.response?.articles?.[0];
  assert.ok(article?.link, 'list_articles should return at least one article');

  const download = await handler(
    {
      action: 'download_article',
      url: article.link,
      format: 'html',
    },
    ctx
  );
  assert.equal(download.ok, true);
  assert.ok(download.data.absolute_path);
});

maybeTest('credential flow: list_articles_with_credential and get_comments', async t => {
  const handler = createSkillHandler();
  const ctx = createContext();

  const fakeid = process.env.OPENCLAW_TEST_FAKEID;
  const uin = process.env.OPENCLAW_TEST_UIN;
  const key = process.env.OPENCLAW_TEST_KEY;
  const passTicket = process.env.OPENCLAW_TEST_PASS_TICKET;
  const commentId = process.env.OPENCLAW_TEST_COMMENT_ID;
  const biz = process.env.OPENCLAW_TEST_BIZ;

  if (!(fakeid && uin && key && passTicket)) {
    t.skip('Missing credential env vars for integration test');
    return;
  }

  const list = await handler(
    {
      action: 'list_articles_with_credential',
      fakeid,
      uin,
      key,
      pass_ticket: passTicket,
      begin: 0,
      size: 5,
    },
    ctx
  );
  assert.equal(list.ok, true);

  if (commentId && biz) {
    const comment = await handler(
      {
        action: 'get_comments',
        __biz: biz,
        comment_id: commentId,
        uin,
        key,
        pass_ticket: passTicket,
      },
      ctx
    );
    assert.equal(comment.ok, true);
  }
});

maybeTest('beta flow: get_authorinfo_beta and get_aboutbiz_beta', async t => {
  const handler = createSkillHandler();
  const ctx = createContext();
  const fakeid = process.env.OPENCLAW_TEST_FAKEID;
  if (!fakeid) {
    t.skip('Missing OPENCLAW_TEST_FAKEID');
    return;
  }

  const authorInfo = await handler(
    {
      action: 'get_authorinfo_beta',
      fakeid,
    },
    ctx
  );
  assert.equal(authorInfo.ok, true);

  const aboutBiz = await handler(
    {
      action: 'get_aboutbiz_beta',
      fakeid,
      key: process.env.OPENCLAW_TEST_ABOUTBIZ_KEY || '',
    },
    ctx
  );
  assert.equal(aboutBiz.ok, true);
});
