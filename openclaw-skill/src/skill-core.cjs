const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { z } = require('zod');

const ACTIONS = [
  'session_start',
  'login_get_qrcode',
  'login_scan_status',
  'login_finalize',
  'authkey_validate',
  'logout',
  'search_account',
  'add_account_search',
  'search_account_by_url',
  'list_articles',
  'add_account_sync',
  'list_articles_with_credential',
  'download_article',
  'get_comments',
  'get_album',
  'get_authorinfo_beta',
  'get_aboutbiz_beta',
  'get_current_ip',
  'worker_overview_metrics',
  'worker_blocked_ip_list',
  'worker_security_top_n',
];

const DEFAULT_NITRO_BASE_URL = 'http://127.0.0.1:3000';
const DEFAULT_NITRO_BOOT_MODE = 'embedded';
const EXPORT_ROOT = '.data/openclaw-exports';
const WECHAT_ALLOWED_HOSTS = new Set(['mp.weixin.qq.com', 'weixin.qq.com']);
const SAFE_LOG_KEYS = new Set(['action', 'keyword', 'fakeid', 'format', 'begin', 'size']);

class SkillError extends Error {
  constructor(code, message, upstream) {
    super(message);
    this.name = 'SkillError';
    this.code = code;
    this.upstream = upstream;
  }
}

const baseInputSchema = z.object({
  action: z.enum(ACTIONS),
});

const actionInputSchemas = {
  session_start: z.object({
    sid: z.string().min(1, 'sid 不能为空'),
  }),
  login_get_qrcode: z.object({}),
  login_scan_status: z.object({}),
  login_finalize: z.object({}),
  authkey_validate: z.object({}),
  logout: z.object({}),
  search_account: z.object({
    keyword: z.string().min(1, 'keyword 不能为空'),
    begin: z.coerce.number().int().min(0).default(0),
    size: z.coerce.number().int().min(1).max(20).default(5),
  }),
  add_account_search: z.object({
    keyword: z.string().min(1, 'keyword 不能为空'),
    begin: z.coerce.number().int().min(0).default(0),
    size: z.coerce.number().int().min(1).max(20).default(5),
  }),
  search_account_by_url: z.object({
    url: z.string().min(1, 'url 不能为空'),
  }),
  list_articles: z.object({
    fakeid: z.string().min(1, 'fakeid 不能为空'),
    begin: z.coerce.number().int().min(0).default(0),
    size: z.coerce.number().int().min(1).max(20).default(5),
    keyword: z.string().default(''),
  }),
  add_account_sync: z.object({
    fakeid: z.string().min(1, 'fakeid 不能为空'),
    begin: z.coerce.number().int().min(0).default(0),
    size: z.coerce.number().int().min(1).max(20).default(5),
    keyword: z.string().default(''),
    max_pages: z.coerce.number().int().min(1).max(100).default(1),
  }),
  list_articles_with_credential: z.object({
    fakeid: z.string().min(1, 'fakeid 不能为空'),
    uin: z.string().min(1, 'uin 不能为空'),
    key: z.string().min(1, 'key 不能为空'),
    pass_ticket: z.string().min(1, 'pass_ticket 不能为空'),
    begin: z.coerce.number().int().min(0).default(0),
    size: z.coerce.number().int().min(1).max(20).default(10),
  }),
  download_article: z.object({
    url: z.string().min(1, 'url 不能为空'),
    format: z.enum(['html', 'markdown', 'text', 'json']).default('html'),
  }),
  get_comments: z.object({
    __biz: z.string().min(1, '__biz 不能为空'),
    comment_id: z.string().min(1, 'comment_id 不能为空'),
    uin: z.string().min(1, 'uin 不能为空'),
    key: z.string().min(1, 'key 不能为空'),
    pass_ticket: z.string().min(1, 'pass_ticket 不能为空'),
  }),
  get_album: z.object({
    fakeid: z.string().min(1, 'fakeid 不能为空'),
    album_id: z.string().min(1, 'album_id 不能为空'),
    is_reverse: z.enum(['0', '1']).default('0'),
    count: z.coerce.number().int().min(1).max(100).default(20),
    begin_msgid: z.string().optional(),
    begin_itemidx: z.string().optional(),
  }),
  get_authorinfo_beta: z.object({
    fakeid: z.string().min(1, 'fakeid 不能为空'),
  }),
  get_aboutbiz_beta: z.object({
    fakeid: z.string().min(1, 'fakeid 不能为空'),
    key: z.string().optional(),
  }),
  get_current_ip: z.object({}),
  worker_overview_metrics: z.object({}),
  worker_blocked_ip_list: z.object({}),
  worker_security_top_n: z.object({
    name: z.string().min(1, 'name 不能为空'),
  }),
};

function createSkillHandler(options = {}) {
  const fetchImpl = options.fetch || global.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('global fetch 不可用');
  }

  const spawnImpl = options.spawn || spawn;
  const now = options.now || (() => new Date());
  const projectRoot = options.projectRoot || path.resolve(__dirname, '../..');

  const runtime = {
    cookieJar: new Map(),
    bootingPromise: null,
    nitroProcess: null,
    currentBaseUrl: null,
    stateLoaded: false,
    persistedAuthKey: '',
  };

  process.on('exit', () => {
    if (runtime.nitroProcess && !runtime.nitroProcess.killed) {
      runtime.nitroProcess.kill('SIGTERM');
    }
  });

  async function handle(input, context = {}) {
    try {
      const parsed = normalizeInput(input);
      const config = resolveConfig(context);
      await loadStateIfNeeded();
      config.openclawAuthKey = getEffectiveAuthKey(config);
      runtime.currentBaseUrl = config.nitroBaseUrl;

      logInfo(context, `action=${parsed.action} params=${safeLogParams(parsed)}`);

      const result = await dispatchAction({
        actionInput: parsed,
        config,
        context,
      });

      return {
        ok: true,
        data: result,
      };
    } catch (error) {
      return {
        ok: false,
        error: normalizeError(error),
      };
    }
  }

  async function dispatchAction({ actionInput, config, context }) {
    const { action } = actionInput;

    switch (action) {
      case 'session_start': {
        const resp = await callApi({
          config,
          context,
          path: `/api/web/login/session/${encodeURIComponent(actionInput.sid)}`,
          method: 'POST',
          expect: 'json',
        });
        return buildApiSummary(resp.data);
      }
      case 'login_get_qrcode': {
        const resp = await callApi({
          config,
          context,
          path: '/api/web/login/getqrcode',
          method: 'GET',
          expect: 'buffer',
        });
        const ext = detectFileExtByType(resp.contentType, 'png');
        const output = await writeBinaryOutput({
          action: 'login_get_qrcode',
          extension: ext,
          content: resp.data,
          projectRoot,
          now,
        });

        return {
          ...output,
          content_type: resp.contentType,
          summary: `二维码已保存到本地文件，可直接打开扫码登录`,
        };
      }
      case 'login_scan_status': {
        const resp = await callApi({
          config,
          context,
          path: '/api/web/login/scan',
          method: 'GET',
          expect: 'json',
        });
        return buildApiSummary(resp.data);
      }
      case 'login_finalize': {
        const resp = await callApi({
          config,
          context,
          path: '/api/web/login/bizlogin',
          method: 'POST',
          expect: 'json',
        });
        const authKey = runtime.cookieJar.get('auth-key') || '';
        if (authKey) {
          await persistAuthKey(authKey);
        }
        return {
          ...buildApiSummary(resp.data),
          auth_key: authKey || undefined,
          summary: authKey
            ? '登录成功，已从响应中捕获 auth-key；请将该值配置到 OPENCLAW_AUTH_KEY secret'
            : '登录请求已完成，但未捕获 auth-key',
        };
      }
      case 'authkey_validate': {
        assertAuthKey(config);
        const resp = await callApi({
          config,
          context,
          path: '/api/public/v1/authkey',
          method: 'GET',
          expect: 'json',
          authRequired: true,
        });
        return buildApiSummary(resp.data);
      }
      case 'logout': {
        assertAuthKey(config);
        const resp = await callApi({
          config,
          context,
          path: '/api/web/mp/logout',
          method: 'GET',
          expect: 'json',
          authRequired: true,
        });
        runtime.cookieJar.delete('auth-key');
        await persistAuthKey('');
        return buildApiSummary(resp.data);
      }
      case 'search_account': {
        assertAuthKey(config);
        const resp = await callApi({
          config,
          context,
          path: '/api/public/v1/account',
          method: 'GET',
          query: {
            keyword: actionInput.keyword,
            begin: actionInput.begin,
            size: actionInput.size,
          },
          expect: 'json',
          authRequired: true,
        });
        return buildApiSummary(resp.data);
      }
      case 'add_account_search': {
        assertAuthKey(config);
        const resp = await callApi({
          config,
          context,
          path: '/api/public/v1/account',
          method: 'GET',
          query: {
            keyword: actionInput.keyword,
            begin: actionInput.begin,
            size: actionInput.size,
          },
          expect: 'json',
          authRequired: true,
        });

        assertBusinessSuccess(resp.data, `搜索公众号失败(${actionInput.keyword})`);
        const list = Array.isArray(resp.data?.list) ? resp.data.list : [];
        const candidates = list.map((item, idx) => ({
          index: actionInput.begin + idx,
          fakeid: item.fakeid || '',
          nickname: item.nickname || '',
          alias: item.alias || '',
          service_type: item.service_type,
          verify_status: item.verify_status,
          signature: item.signature || '',
          round_head_img: item.round_head_img || '',
        }));

        return {
          keyword: actionInput.keyword,
          begin: actionInput.begin,
          size: actionInput.size,
          total: Number(resp.data?.total || candidates.length),
          candidates,
          summary:
            candidates.length > 0
              ? `找到 ${candidates.length} 个候选公众号，请选择 fakeid 后调用 add_account_sync`
              : `未找到与「${actionInput.keyword}」匹配的公众号`,
        };
      }
      case 'search_account_by_url': {
        assertAuthKey(config);
        assertWechatUrl(actionInput.url);
        const resp = await callApi({
          config,
          context,
          path: '/api/public/v1/accountbyurl',
          method: 'GET',
          query: {
            url: actionInput.url,
          },
          expect: 'json',
          authRequired: true,
        });
        return buildApiSummary(resp.data);
      }
      case 'list_articles': {
        assertAuthKey(config);
        const resp = await callApi({
          config,
          context,
          path: '/api/public/v1/article',
          method: 'GET',
          query: {
            fakeid: actionInput.fakeid,
            begin: actionInput.begin,
            size: actionInput.size,
            keyword: actionInput.keyword || '',
          },
          expect: 'json',
          authRequired: true,
        });
        return buildApiSummary(resp.data);
      }
      case 'add_account_sync': {
        assertAuthKey(config);

        let begin = actionInput.begin;
        let pages = 0;
        let syncedMessages = 0;
        const articles = [];

        while (pages < actionInput.max_pages) {
          const resp = await callApi({
            config,
            context,
            path: '/api/public/v1/article',
            method: 'GET',
            query: {
              fakeid: actionInput.fakeid,
              begin: begin,
              size: actionInput.size,
              keyword: actionInput.keyword || '',
            },
            expect: 'json',
            authRequired: true,
          });

          assertBusinessSuccess(resp.data, `同步公众号文章失败(${actionInput.fakeid})`);

          const pageArticles = Array.isArray(resp.data?.articles) ? resp.data.articles : [];
          if (pageArticles.length === 0) {
            break;
          }

          pages += 1;
          articles.push(...pageArticles.map(toArticleSummary));

          const pageMessageCount = getMessageCount(pageArticles);
          if (pageMessageCount <= 0) {
            break;
          }

          syncedMessages += pageMessageCount;
          begin += pageMessageCount;

          if (pageArticles.length < actionInput.size) {
            break;
          }
        }

        return {
          fakeid: actionInput.fakeid,
          begin: actionInput.begin,
          next_begin: begin,
          size: actionInput.size,
          keyword: actionInput.keyword || '',
          max_pages: actionInput.max_pages,
          synced_pages: pages,
          synced_messages: syncedMessages,
          synced_articles: articles.length,
          articles,
          summary:
            pages > 0
              ? `已同步 ${pages} 页（${syncedMessages} 条消息，${articles.length} 篇文章）`
              : '未拉取到可同步的文章数据',
        };
      }
      case 'list_articles_with_credential': {
        const resp = await callApi({
          config,
          context,
          path: '/api/web/mp/profile_ext_getmsg',
          method: 'GET',
          query: {
            id: actionInput.fakeid,
            begin: actionInput.begin,
            size: actionInput.size,
            uin: actionInput.uin,
            key: actionInput.key,
            pass_ticket: actionInput.pass_ticket,
          },
          expect: 'json',
        });
        return buildApiSummary(resp.data);
      }
      case 'download_article': {
        assertWechatUrl(actionInput.url);

        const resp = await callApi({
          config,
          context,
          path: '/api/public/v1/download',
          method: 'GET',
          query: {
            url: actionInput.url,
            format: actionInput.format,
          },
          expect: actionInput.format === 'json' ? 'json' : 'text',
        });

        const output = await writeDownloadOutput({
          format: actionInput.format,
          url: actionInput.url,
          payload: resp.data,
          projectRoot,
          now,
        });

        return output;
      }
      case 'get_comments': {
        const resp = await callApi({
          config,
          context,
          path: '/api/web/misc/comment',
          method: 'GET',
          query: {
            __biz: actionInput.__biz,
            comment_id: actionInput.comment_id,
            uin: actionInput.uin,
            key: actionInput.key,
            pass_ticket: actionInput.pass_ticket,
          },
          expect: 'json',
        });
        return buildApiSummary(resp.data);
      }
      case 'get_album': {
        const resp = await callApi({
          config,
          context,
          path: '/api/web/misc/appmsgalbum',
          method: 'GET',
          query: {
            fakeid: actionInput.fakeid,
            album_id: actionInput.album_id,
            is_reverse: actionInput.is_reverse,
            count: actionInput.count,
            begin_msgid: actionInput.begin_msgid,
            begin_itemidx: actionInput.begin_itemidx,
          },
          expect: 'json',
        });
        return buildApiSummary(resp.data);
      }
      case 'get_authorinfo_beta': {
        const resp = await callApi({
          config,
          context,
          path: '/api/public/beta/authorinfo',
          method: 'GET',
          query: {
            fakeid: actionInput.fakeid,
          },
          expect: 'json',
        });
        return buildApiSummary(resp.data);
      }
      case 'get_aboutbiz_beta': {
        const resp = await callApi({
          config,
          context,
          path: '/api/public/beta/aboutbiz',
          method: 'GET',
          query: {
            fakeid: actionInput.fakeid,
            key: actionInput.key,
          },
          expect: 'json',
        });
        return buildApiSummary(resp.data);
      }
      case 'get_current_ip': {
        const resp = await callApi({
          config,
          context,
          path: '/api/web/misc/current-ip',
          method: 'GET',
          expect: 'json',
        });
        return buildApiSummary(resp.data);
      }
      case 'worker_overview_metrics': {
        const resp = await callApi({
          config,
          context,
          path: '/api/web/worker/overview-metrics',
          method: 'GET',
          expect: 'json',
        });
        return buildApiSummary(resp.data);
      }
      case 'worker_blocked_ip_list': {
        const resp = await callApi({
          config,
          context,
          path: '/api/web/worker/blocked-ip-list',
          method: 'GET',
          expect: 'json',
        });
        return buildApiSummary(resp.data);
      }
      case 'worker_security_top_n': {
        const resp = await callApi({
          config,
          context,
          path: '/api/web/worker/security-top-n',
          method: 'GET',
          query: {
            name: actionInput.name,
          },
          expect: 'json',
        });
        return buildApiSummary(resp.data);
      }
      default:
        throw new SkillError('UNKNOWN_ACTION', `未知 action: ${actionInput.action}`);
    }
  }

  function normalizeInput(input) {
    const parsedBase = baseInputSchema.safeParse(input);
    if (!parsedBase.success) {
      throw new SkillError('INVALID_INPUT', parsedBase.error.issues[0]?.message || '输入格式错误');
    }

    const action = parsedBase.data.action;
    const schema = actionInputSchemas[action];
    if (!schema) {
      throw new SkillError('UNKNOWN_ACTION', `未知 action: ${action}`);
    }

    const merged = {
      ...input,
    };
    delete merged.action;
    const parsed = schema.safeParse(merged);
    if (!parsed.success) {
      throw new SkillError('INVALID_INPUT', parsed.error.issues[0]?.message || '参数校验失败');
    }

    return {
      action,
      ...parsed.data,
    };
  }

  async function callApi({
    config,
    context,
    path: endpointPath,
    method,
    query,
    expect = 'json',
    authRequired = false,
  }) {
    await ensureNitroAvailable({ config, context });

    const requestUrl = new URL(endpointPath, ensureTrailingSlash(config.nitroBaseUrl));
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') {
          requestUrl.searchParams.set(key, String(value));
        }
      }
    }

    const headers = new Headers();
    if (authRequired && config.openclawAuthKey) {
      headers.set('X-Auth-Key', config.openclawAuthKey);
    }
    const cookieHeader = serializeCookieJar(runtime.cookieJar);
    if (cookieHeader) {
      headers.set('Cookie', cookieHeader);
    }

    const reqInit = {
      method,
      headers,
      signal: AbortSignal.timeout(30_000),
    };

    let response;
    try {
      response = await fetchImpl(requestUrl, reqInit);
    } catch (error) {
      if (config.nitroBootMode === 'embedded') {
        await restartNitro({ config, context, reason: 'request_failed' });
        response = await fetchImpl(requestUrl, reqInit);
      } else {
        throw new SkillError('UPSTREAM_UNAVAILABLE', 'Nitro 服务不可用，请检查 NITRO_BASE_URL', {
          message: String(error),
        });
      }
    }

    const cookieBefore = serializeCookieJar(runtime.cookieJar);
    updateCookieJar(runtime.cookieJar, getSetCookies(response));
    const cookieAfter = serializeCookieJar(runtime.cookieJar);
    if (cookieAfter !== cookieBefore) {
      await persistState();
    }
    const cookieAuthKey = runtime.cookieJar.get('auth-key') || '';
    if (cookieAuthKey && cookieAuthKey !== runtime.persistedAuthKey) {
      await persistAuthKey(cookieAuthKey);
    }

    const contentType = response.headers.get('content-type') || '';
    let data;
    if (expect === 'buffer') {
      const arrayBuffer = await response.arrayBuffer();
      data = Buffer.from(arrayBuffer);
    } else if (expect === 'text') {
      data = await response.text();
    } else if (expect === 'json') {
      data = await safeReadJson(response);
    } else {
      data = await safeReadAuto(response);
    }

    if (!response.ok) {
      throw new SkillError('UPSTREAM_HTTP_ERROR', `上游服务返回 HTTP ${response.status}`, {
        status: response.status,
        statusText: response.statusText,
        body: data,
      });
    }

    return {
      data,
      contentType,
    };
  }

  async function ensureNitroAvailable({ config, context }) {
    const healthy = await isNitroHealthy({ baseUrl: config.nitroBaseUrl, fetchImpl });
    if (healthy) {
      return;
    }

    if (config.nitroBootMode !== 'embedded') {
      throw new SkillError('UPSTREAM_UNAVAILABLE', 'Nitro 服务不可达且 NITRO_BOOT_MODE=external');
    }

    if (runtime.bootingPromise) {
      await runtime.bootingPromise;
      return;
    }

    runtime.bootingPromise = startNitroProcess({ config, context });
    try {
      await runtime.bootingPromise;
    } finally {
      runtime.bootingPromise = null;
    }
  }

  async function restartNitro({ config, context, reason }) {
    if (runtime.nitroProcess && !runtime.nitroProcess.killed) {
      runtime.nitroProcess.kill('SIGTERM');
      runtime.nitroProcess = null;
    }
    logWarn(context, `Nitro 自动重启，原因=${reason}`);
    await startNitroProcess({ config, context });
  }

  async function startNitroProcess({ config, context }) {
    if (config.nitroBootMode !== 'embedded') {
      return;
    }

    const url = new URL(config.nitroBaseUrl);
    const port = Number(url.port || '3000');
    const host = url.hostname || '127.0.0.1';
    const outputServerPath = path.join(projectRoot, '.output/server/index.mjs');

    let child;

    if (config.nitroStartCommand) {
      child = spawnImpl(config.nitroStartCommand, {
        cwd: projectRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        env: {
          ...process.env,
          PORT: String(port),
          NITRO_PORT: String(port),
          HOST: host,
          NITRO_HOST: host,
        },
      });
    } else if (require('node:fs').existsSync(outputServerPath)) {
      child = spawnImpl('node', ['.output/server/index.mjs'], {
        cwd: projectRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PORT: String(port),
          NITRO_PORT: String(port),
          HOST: host,
          NITRO_HOST: host,
        },
      });
    } else {
      child = spawnImpl('yarn', ['dev', '--host', host, '--port', String(port)], {
        cwd: projectRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PORT: String(port),
          NITRO_PORT: String(port),
          HOST: host,
          NITRO_HOST: host,
        },
      });
    }

    runtime.nitroProcess = child;

    child.stdout?.on('data', chunk => {
      logInfo(context, `nitro: ${redactSecret(String(chunk))}`.trim());
    });
    child.stderr?.on('data', chunk => {
      logWarn(context, `nitro: ${redactSecret(String(chunk))}`.trim());
    });
    child.on('exit', code => {
      logWarn(context, `nitro 进程退出，code=${code ?? 'null'}`);
      if (runtime.nitroProcess && runtime.nitroProcess.pid === child.pid) {
        runtime.nitroProcess = null;
      }
    });

    const start = Date.now();
    while (Date.now() - start < 90_000) {
      if (await isNitroHealthy({ baseUrl: config.nitroBaseUrl, fetchImpl })) {
        logInfo(context, 'Nitro 服务已就绪');
        return;
      }
      await sleep(1_000);
    }

    throw new SkillError('NITRO_BOOT_TIMEOUT', 'Nitro 自动启动超时，请检查本地项目依赖和日志');
  }

  async function loadStateIfNeeded() {
    if (runtime.stateLoaded) {
      return;
    }
    runtime.stateLoaded = true;

    try {
      const statePath = path.join(projectRoot, '.data/openclaw-skill/state.json');
      const raw = await fs.readFile(statePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.authKey === 'string') {
        runtime.persistedAuthKey = parsed.authKey;
      }
      if (parsed?.cookieJar && typeof parsed.cookieJar === 'object') {
        for (const [name, value] of Object.entries(parsed.cookieJar)) {
          if (typeof name === 'string' && typeof value === 'string' && name && value) {
            runtime.cookieJar.set(name, value);
          }
        }
      }
    } catch {
      runtime.persistedAuthKey = '';
    }
  }

  function getEffectiveAuthKey(config) {
    return config.openclawAuthKey || runtime.cookieJar.get('auth-key') || runtime.persistedAuthKey || '';
  }

  async function persistAuthKey(authKey) {
    runtime.persistedAuthKey = authKey || '';
    await persistState();
  }

  async function persistState() {
    try {
      const dir = path.join(projectRoot, '.data/openclaw-skill');
      await fs.mkdir(dir, { recursive: true });
      const statePath = path.join(dir, 'state.json');
      const cookieJar = Object.fromEntries(runtime.cookieJar.entries());
      await fs.writeFile(
        statePath,
        JSON.stringify(
          {
            authKey: runtime.persistedAuthKey,
            cookieJar: cookieJar,
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        ),
        'utf8'
      );
    } catch {
      // ignore persistence errors
    }
  }

  return handle;
}

function resolveConfig(context) {
  const cfg = context?.config || {};
  return {
    nitroBaseUrl: String(cfg.NITRO_BASE_URL || process.env.NITRO_BASE_URL || DEFAULT_NITRO_BASE_URL),
    nitroBootMode: String(cfg.NITRO_BOOT_MODE || process.env.NITRO_BOOT_MODE || DEFAULT_NITRO_BOOT_MODE).toLowerCase(),
    openclawAuthKey: String(cfg.OPENCLAW_AUTH_KEY || process.env.OPENCLAW_AUTH_KEY || ''),
    nitroStartCommand: String(cfg.NITRO_START_COMMAND || process.env.NITRO_START_COMMAND || ''),
  };
}

function assertAuthKey(config) {
  if (!config.openclawAuthKey) {
    throw new SkillError(
      'MISSING_AUTH_KEY',
      '缺少可用 auth-key。请先执行扫码登录流程（session_start -> login_get_qrcode -> login_scan_status -> login_finalize），或配置 OPENCLAW_AUTH_KEY'
    );
  }
}

function assertWechatUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SkillError('INVALID_INPUT', 'url 格式不合法');
  }

  if (parsed.protocol !== 'https:') {
    throw new SkillError('INVALID_INPUT', '仅支持 https 协议的微信文章地址');
  }
  if (!WECHAT_ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new SkillError('INVALID_INPUT', '仅允许 mp.weixin.qq.com 或 weixin.qq.com');
  }
}

function assertBusinessSuccess(data, fallbackMessage) {
  const ret = data?.base_resp?.ret;
  if (typeof ret === 'number' && ret !== 0) {
    throw new SkillError('UPSTREAM_BUSINESS_ERROR', fallbackMessage || '上游业务返回失败', {
      ret: ret,
      err_msg: data?.base_resp?.err_msg || '',
      body: data,
    });
  }
}

function getMessageCount(articles) {
  if (!Array.isArray(articles) || articles.length === 0) {
    return 0;
  }
  const count = articles.filter(item => Number(item?.itemidx) === 1).length;
  return count > 0 ? count : articles.length;
}

function toArticleSummary(article) {
  return {
    aid: article?.aid || '',
    itemidx: Number(article?.itemidx || 0),
    title: article?.title || '',
    link: article?.link || '',
    author_name: article?.author_name || '',
    create_time: Number(article?.create_time || 0),
    update_time: Number(article?.update_time || 0),
  };
}

async function safeReadJson(response) {
  try {
    const txt = await response.text();
    return JSON.parse(txt);
  } catch {
    throw new SkillError('UPSTREAM_PARSE_ERROR', '上游 JSON 解析失败', {
      body: '[unparseable json body]',
    });
  }
}

async function safeReadAuto(response) {
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    return safeReadJson(response);
  }
  return response.text();
}

async function isNitroHealthy({ baseUrl, fetchImpl }) {
  try {
    const resp = await fetchImpl(new URL('/api/web/misc/current-ip', ensureTrailingSlash(baseUrl)), {
      method: 'GET',
      signal: AbortSignal.timeout(2_000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

function ensureTrailingSlash(input) {
  return input.endsWith('/') ? input : `${input}/`;
}

function getSetCookies(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie();
  }
  const joined = response.headers.get('set-cookie');
  if (!joined) {
    return [];
  }
  return splitSetCookie(joined);
}

function splitSetCookie(joined) {
  const cookies = [];
  let current = '';
  let inExpires = false;

  for (let i = 0; i < joined.length; i += 1) {
    const ch = joined[i];
    if (ch === ',') {
      if (inExpires) {
        current += ch;
        continue;
      }
      cookies.push(current.trim());
      current = '';
      continue;
    }
    current += ch;

    const lowerTail = current.slice(-8).toLowerCase();
    if (lowerTail === 'expires=') {
      inExpires = true;
    }
    if (inExpires && ch === ';') {
      inExpires = false;
    }
  }

  if (current.trim()) {
    cookies.push(current.trim());
  }
  return cookies;
}

function updateCookieJar(cookieJar, setCookies) {
  for (const line of setCookies) {
    const firstPart = line.split(';')[0]?.trim();
    if (!firstPart) {
      continue;
    }
    const eqIndex = firstPart.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    const name = firstPart.slice(0, eqIndex);
    const value = firstPart.slice(eqIndex + 1);
    if (!name) {
      continue;
    }
    if (!value || value.toUpperCase() === 'EXPIRED') {
      cookieJar.delete(name);
    } else {
      cookieJar.set(name, value);
    }
  }
}

function serializeCookieJar(cookieJar) {
  if (!cookieJar || cookieJar.size === 0) {
    return '';
  }
  return Array.from(cookieJar.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function normalizeError(error) {
  if (error instanceof SkillError) {
    return {
      code: error.code,
      message: error.message,
      upstream: error.upstream,
    };
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return {
      code: 'UNEXPECTED_ERROR',
      message: error.message,
    };
  }

  return {
    code: 'UNEXPECTED_ERROR',
    message: '未知错误',
  };
}

async function writeDownloadOutput({ format, url, payload, projectRoot, now }) {
  const extensionMap = {
    html: 'html',
    markdown: 'md',
    text: 'txt',
    json: 'json',
  };

  const ext = extensionMap[format] || 'txt';
  const fileName = `download-${shortHash(url)}.${ext}`;

  let content;
  if (format === 'json') {
    content = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
  } else {
    content = Buffer.from(String(payload), 'utf8');
  }

  const output = await writeBinaryOutput({
    action: 'download_article',
    extension: ext,
    content,
    fileName,
    projectRoot,
    now,
  });

  return {
    ...output,
    format,
    summary: `文章已导出为 ${format} 格式并写入本地文件`,
  };
}

async function writeBinaryOutput({ action, extension, content, fileName, projectRoot, now }) {
  const timestamp = formatTs(now());
  const folder = path.join(projectRoot, EXPORT_ROOT, timestamp);
  await fs.mkdir(folder, { recursive: true });

  const finalFileName = fileName || `${action}-${shortHash(String(Date.now()))}.${extension}`;
  const absolutePath = path.join(folder, sanitizeFileName(finalFileName));

  await fs.writeFile(absolutePath, content);

  return {
    absolute_path: absolutePath,
    size_bytes: content.length,
  };
}

function detectFileExtByType(contentType, fallback) {
  if (!contentType) {
    return fallback;
  }
  if (contentType.includes('png')) {
    return 'png';
  }
  if (contentType.includes('jpeg') || contentType.includes('jpg')) {
    return 'jpg';
  }
  if (contentType.includes('svg')) {
    return 'svg';
  }
  return fallback;
}

function buildApiSummary(data) {
  return {
    response: data,
  };
}

function shortHash(input) {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 10);
}

function sanitizeFileName(name) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
}

function formatTs(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function redactSecret(input) {
  return input.replace(/auth-key=([a-zA-Z0-9_-]+)/g, 'auth-key=[REDACTED]');
}

function safeLogParams(parsedInput) {
  const pairs = [];
  Object.entries(parsedInput).forEach(([key, value]) => {
    if (key === 'action' || SAFE_LOG_KEYS.has(key)) {
      pairs.push(`${key}:${String(value)}`);
    }
  });
  return `{${pairs.join(', ')}}`;
}

function logInfo(context, msg) {
  if (context?.logger?.info) {
    context.logger.info(msg);
  }
}

function logWarn(context, msg) {
  if (context?.logger?.warn) {
    context.logger.warn(msg);
  }
}

module.exports = {
  ACTIONS,
  SkillError,
  createSkillHandler,
  normalizeError,
  resolveConfig,
  assertWechatUrl,
  splitSetCookie,
  serializeCookieJar,
};
