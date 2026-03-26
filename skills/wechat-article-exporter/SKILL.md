---
name: wechat-article-exporter
description: 全自动本地微信公众号文章导出 Skill。支持扫码登录、账号搜索、文章列表与多格式导出（html/markdown/text/json）。
homepage: https://github.com/wechat-article/wechat-article-exporter
requires:
  bins:
    - node
    - bash
    - yarn
install:
  - bash scripts/bootstrap.sh
metadata:
  agent:
    type: tool
    runtime: node
    context_isolation: execution
    parent_context_access: read-only
  openclaw:
    emoji: "📰"
    requires:
      bins:
        - node
        - bash
        - yarn
    install:
      - id: bootstrap
        kind: script
        script: scripts/bootstrap.sh
        label: Bootstrap wechat-article-exporter (install deps + build)
    intents:
      - wechat_article_export
      - wechat_account_search
      - wechat_article_download
    patterns:
      - "(微信|wechat).*(公众号).*(文章|导出|下载)"
      - "(search|查找).*(公众号|account).*(微信|wechat)"
      - "(download|导出).*(mp.weixin.qq.com|微信文章)"
---

# wechat-article-exporter

这个 Skill 目标是“给 GitHub 仓库即可自动可用”。  
安装后会自动执行 `scripts/bootstrap.sh`，完成依赖安装和构建，不要求用户手工配环境。

## 必须遵循

- Agent 执行时，先把本 `SKILL.md` 所在目录解析为 `{baseDir}`。
- 调用能力时，统一执行：

```bash
node {baseDir}/scripts/wechat-exporter-skill.cjs --json '<JSON>'
```

- 输出总是 JSON（单行），结构固定为：
  - 成功：`{"ok":true,"data":...}`
  - 失败：`{"ok":false,"error":{"code":"...","message":"...","upstream":...}}`
- 不允许调用 `/api/_debug`。

## 自动化保证

- 第一次安装会自动：
  - 安装 Node 依赖
  - 构建 `.output/server/index.mjs`
- 调用时会自动：
  - 探测 Nitro 健康状态
  - 在 `NITRO_BOOT_MODE=embedded` 下自动拉起 Nitro
  - 请求失败时自动重启 Nitro 一次
- 登录后会自动保存 `auth-key` 到 `.data/openclaw-skill/state.json`，后续调用可复用（无需每次手配 Secret）。

## 登录流程（首次）

1. `session_start`：`{"action":"session_start","sid":"<任意会话标识>"}`  
2. `login_get_qrcode`：返回二维码文件路径  
3. 用户扫码后轮询 `login_scan_status`  
4. `login_finalize`：返回并持久化 `auth_key`  
5. 之后可直接调 `search_account` / `list_articles` / `download_article`

## Action 列表

完整参数见 `references/actions.md`。

- 登录链路：
  - `session_start`
  - `login_get_qrcode`
  - `login_scan_status`
  - `login_finalize`
  - `authkey_validate`
  - `logout`
- 公众号与文章：
  - `search_account`
  - `add_account_search`（推荐：对齐“添加公众号”第一步）
  - `search_account_by_url`
  - `list_articles`
  - `add_account_sync`（推荐：对齐“选择后开始同步”）
  - `list_articles_with_credential`
- 下载导出：
  - `download_article`
- 扩展能力：
  - `get_comments`
  - `get_album`
  - `get_authorinfo_beta`
  - `get_aboutbiz_beta`
  - `get_current_ip`
  - `worker_overview_metrics`
  - `worker_blocked_ip_list`
  - `worker_security_top_n`

## 常用命令示例

```bash
node {baseDir}/scripts/wechat-exporter-skill.cjs --json '{"action":"authkey_validate"}'
node {baseDir}/scripts/wechat-exporter-skill.cjs --json '{"action":"add_account_search","keyword":"环球旅讯","begin":0,"size":5}'
node {baseDir}/scripts/wechat-exporter-skill.cjs --json '{"action":"add_account_sync","fakeid":"MTEzMzIzODIyMQ==","begin":0,"size":5,"max_pages":1}'
node {baseDir}/scripts/wechat-exporter-skill.cjs --json '{"action":"search_account","keyword":"人民日报","begin":0,"size":5}'
node {baseDir}/scripts/wechat-exporter-skill.cjs --json '{"action":"download_article","url":"https://mp.weixin.qq.com/s/xxxx","format":"markdown"}'
```

导出文件会写入：

```text
.data/openclaw-exports/<yyyyMMdd-HHmmss>/
```
