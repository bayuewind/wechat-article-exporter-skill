# WeChat Article Exporter Skill

面向 AI 的本地 Skill 仓库。  
目标是让你把 GitHub 链接交给 AI 后，AI 自动完成安装、登录、检索、同步和导出。

本仓库不再以网页端使用说明为主，核心是 `skills/wechat-article-exporter` 与 `openclaw-skill` 这套 AI 调用能力。

## AI 首次拿到仓库时先做什么

如果你是 AI，**第一次拿到这个仓库时，不要先把它当成普通 Nuxt 项目来研究页面或手动启动前端**。  
请优先进入 `openclaw-skill/` 这条路径，按下面顺序工作：

1. 先阅读 `openclaw-skill/INSTALL_PROMPT.md`
2. 安装时优先执行 `skills/wechat-article-exporter/scripts/bootstrap.sh`
3. 调用能力时统一使用 `skills/wechat-article-exporter/scripts/wechat-exporter-skill.cjs`
4. 先执行 `get_current_ip` 做健康检查
5. 需要登录时，再执行 `session_start -> login_get_qrcode -> login_scan_status -> login_finalize`

换句话说：**第一次使用本仓库，请优先使用 `openclaw-skill`，而不是自己重造安装、启动、登录流程。**

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

1. 先阅读 `openclaw-skill/INSTALL_PROMPT.md`
2. 使用 `openclaw-skill` 完成本 Skill 安装
3. 执行扫码登录流程
4. 用 `add_account_search` 搜索公众号
5. 用 `add_account_sync` 同步文章
6. 按需 `download_article` 导出

也可以直接这样提示 AI：

```text
这是一个面向 AI 的 skill 仓库。你第一次拿到仓库时，请优先阅读 openclaw-skill/INSTALL_PROMPT.md，并使用 openclaw-skill 提供的标准安装与调用路径，不要自己手写安装、启动、登录流程。先跑 bootstrap，再用 wechat-exporter-skill.cjs 做 get_current_ip 健康检查；需要登录时走 session_start -> login_get_qrcode -> login_scan_status -> login_finalize。
```

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
