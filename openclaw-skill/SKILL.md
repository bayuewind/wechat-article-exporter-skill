# 微信公众号文章导出 Skill

本 Skill 连接本地 `wechat-article-exporter` 服务，按 `action` 执行不同能力。

## 关键原则

- 所有调用统一返回 `{ ok, data?, error? }`。
- 需要登录态的动作，必须已配置 `OPENCLAW_AUTH_KEY`。
- 需要登录态的动作优先使用 `OPENCLAW_AUTH_KEY`；若未配置，会自动尝试读取 `.data/openclaw-skill/state.json` 中持久化的 `auth-key`。
- `download_article` 与 `login_get_qrcode` 会落盘到 `.data/openclaw-exports/<yyyyMMdd-HHmmss>/`，只返回路径和摘要。
- 不暴露调试接口 `/api/_debug`。

## 推荐调用流程

1. 登录态可用时：`authkey_validate -> search_account -> list_articles -> download_article`
2. 需要扫码时：
   - `session_start`（传 sid）
   - `login_get_qrcode`（返回二维码文件路径）
   - 用户扫码后轮询 `login_scan_status`
  - `login_finalize`（返回并自动持久化 `auth_key`）

## Action 一览

- 登录链路：
  - `session_start` (`sid`)
  - `login_get_qrcode`
  - `login_scan_status`
  - `login_finalize`
  - `authkey_validate`
  - `logout`
- 账号与文章：
  - `search_account` (`keyword`, `begin?`, `size?`)
  - `search_account_by_url` (`url`)
  - `list_articles` (`fakeid`, `begin?`, `size?`, `keyword?`)
  - `list_articles_with_credential` (`fakeid`, `uin`, `key`, `pass_ticket`, `begin?`, `size?`)
- 下载导出：
  - `download_article` (`url`, `format?=html`)
- 扩展能力：
  - `get_comments` (`__biz`, `comment_id`, `uin`, `key`, `pass_ticket`)
  - `get_album` (`fakeid`, `album_id`, `is_reverse?`, `count?`, `begin_msgid?`, `begin_itemidx?`)
  - `get_authorinfo_beta` (`fakeid`)
  - `get_aboutbiz_beta` (`fakeid`, `key?`)
  - `get_current_ip`
  - `worker_overview_metrics`
  - `worker_blocked_ip_list`
  - `worker_security_top_n` (`name`)

## 错误说明

- `INVALID_INPUT`: 参数校验失败。
- `MISSING_AUTH_KEY`: 缺少 OpenClaw Secret 中的 `OPENCLAW_AUTH_KEY`。
- `UPSTREAM_UNAVAILABLE`: Nitro 服务不可用。
- `UPSTREAM_HTTP_ERROR`: 上游接口 HTTP 失败。
- `UPSTREAM_PARSE_ERROR`: 上游响应格式异常。
- `NITRO_BOOT_TIMEOUT`: 内嵌 Nitro 启动超时。
