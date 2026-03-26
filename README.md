# WeChat Article Exporter Skill

面向 AI 的本地 Skill 仓库。  
目标是让你把 GitHub 链接交给 AI 后，AI 自动完成安装、登录、检索、同步和导出。

本仓库不再以网页端使用说明为主，核心是 `skills/wechat-article-exporter` 与 `openclaw-skill` 这套 AI 调用能力。

## 你能得到什么

- 自动 bootstrap：首次安装自动装依赖并构建
- 自动运行：Skill 可自动探测并拉起本地 Nitro 服务
- 扫码登录：支持 `session_start -> login_get_qrcode -> login_scan_status -> login_finalize`
- 登录态复用：`auth-key` 与关键 cookie 自动持久化
- 添加公众号流程（对齐网页）：
  - `add_account_search`：先模糊搜索候选公众号
  - `add_account_sync`：选择 `fakeid` 后开始同步文章（默认同步第一页）
- 导出能力：`download_article` 支持 `html | markdown | text | json`

## 一键给 AI 使用

把仓库链接交给 AI，并要求：

1. 安装本 Skill
2. 执行扫码登录流程
3. 用 `add_account_search` 搜索公众号
4. 用 `add_account_sync` 同步文章
5. 按需 `download_article` 导出

## 手动调试（可选）

```bash
# 1) bootstrap
bash skills/wechat-article-exporter/scripts/bootstrap.sh

# 2) 健康检查
node skills/wechat-article-exporter/scripts/wechat-exporter-skill.cjs --json '{"action":"get_current_ip"}'

# 3) 搜索候选公众号（添加流程第 1 步）
node skills/wechat-article-exporter/scripts/wechat-exporter-skill.cjs --json '{"action":"add_account_search","keyword":"环球旅讯","begin":0,"size":5}'

# 4) 选择 fakeid 后同步（添加流程第 2 步）
node skills/wechat-article-exporter/scripts/wechat-exporter-skill.cjs --json '{"action":"add_account_sync","fakeid":"MTEzMzIzODIyMQ==","begin":0,"size":5,"max_pages":1}'
```

## 输出与数据目录

- 导出和二维码文件目录：`.data/openclaw-exports/<yyyyMMdd-HHmmss>/`
- Skill 状态目录：`.data/openclaw-skill/state.json`
- Tool 返回结构：`{ ok, data?, error? }`

## 主要 action

- 登录链路：
  - `session_start`
  - `login_get_qrcode`
  - `login_scan_status`
  - `login_finalize`
  - `authkey_validate`
  - `logout`
- 账号与文章：
  - `add_account_search`
  - `add_account_sync`
  - `search_account`
  - `search_account_by_url`
  - `list_articles`
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

## 仓库关键目录

- `skills/wechat-article-exporter/`：对外分发的 Skill 包
- `openclaw-skill/`：Skill 核心实现（schema、runtime、测试）
- `.claude-plugin/`：插件/市场元数据

## License

MIT
