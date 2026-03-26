# wechat-article-exporter Actions

所有 action 都通过：

```bash
node scripts/wechat-exporter-skill.cjs --json '<JSON>'
```

## 登录链路

- `session_start`
  - required: `sid`
- `login_get_qrcode`
  - no args
- `login_scan_status`
  - no args
- `login_finalize`
  - no args
- `authkey_validate`
  - no args
- `logout`
  - no args

## 公众号与文章

- `search_account`
  - required: `keyword`
  - optional: `begin=0`, `size=5` (1-20)
- `search_account_by_url`
  - required: `url`（仅 `https://mp.weixin.qq.com` / `https://weixin.qq.com`）
- `list_articles`
  - required: `fakeid`
  - optional: `begin=0`, `size=5`, `keyword=''`
- `list_articles_with_credential`
  - required: `fakeid`, `uin`, `key`, `pass_ticket`
  - optional: `begin=0`, `size=10`

## 下载导出

- `download_article`
  - required: `url`
  - optional: `format=html`（`html|markdown|text|json`）
  - output: `absolute_path`, `size_bytes`, `format`, `summary`

## 扩展能力

- `get_comments`
  - required: `__biz`, `comment_id`, `uin`, `key`, `pass_ticket`
- `get_album`
  - required: `fakeid`, `album_id`
  - optional: `is_reverse='0'`, `count=20`, `begin_msgid`, `begin_itemidx`
- `get_authorinfo_beta`
  - required: `fakeid`
- `get_aboutbiz_beta`
  - required: `fakeid`
  - optional: `key`
- `get_current_ip`
  - no args
- `worker_overview_metrics`
  - no args
- `worker_blocked_ip_list`
  - no args
- `worker_security_top_n`
  - required: `name`
