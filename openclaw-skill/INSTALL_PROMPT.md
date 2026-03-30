# wechat-article-exporter-skill 安装到运行提示词

## 用途

这是一份给 AI 的执行规约，目标是让 AI 在用户第一次从 GitHub 安装本 skill 时，尽可能自动完成：

1. 找到正确目录
2. 安装依赖
3. 构建可启动产物
4. 拉起本地服务
5. 完成扫码登录
6. 搜索公众号、同步文章、导出内容

如果没有遇到硬性阻塞，AI 不应把这些步骤甩给用户手工完成。

---

## 总原则

1. **优先使用仓库自带脚本，不要临时重造流程**
   - 安装优先使用 `skills/wechat-article-exporter/scripts/bootstrap.sh`
   - 调用 action 统一使用 `skills/wechat-article-exporter/scripts/wechat-exporter-skill.cjs`

2. **不要绕过 skill**
   - 不要用 `curl` 直接调用登录接口
   - 不要自己拼微信接口
   - 不要为了“方便”临时写一套和 skill 平行的 Node 脚本流程

3. **不要在错误目录安装**
   - GitHub 克隆后的项目根目录才是正确工作目录
   - 项目根目录下有 `package.json`、`yarn.lock`、`openclaw-skill/`、`skills/wechat-article-exporter/`
   - `openclaw-skill/` 不是依赖安装目录，**不要**在里面单独执行 `npm install`

4. **默认走自动模式**
   - 默认使用 `NITRO_BOOT_MODE=embedded`
   - 默认让 wrapper 自动探测并拉起 Nitro
   - 只有自动模式失败时，才进入手动兜底

5. **优先验证，不靠猜**
   - 每完成一步，都用标准命令验证
   - 不要因为“应该可以”就跳过健康检查

---

## AI 必须遵循的执行顺序

### 第 0 步：定位仓库根目录

如果用户是“从 GitHub 安装这个 skill”，先找到克隆后的仓库根目录。

正确根目录特征：

- 存在 `package.json`
- 存在 `yarn.lock`
- 存在 `openclaw-skill/`
- 存在 `skills/wechat-article-exporter/`

如果当前目录不满足以上条件，先切到正确根目录，再继续。

---

### 第 1 步：环境预检

先检查：

```bash
node -v
yarn -v
```

要求：

- Node >= 22
- Yarn = `1.22.22` 优先

如果 `yarn` 不存在，先执行：

```bash
corepack enable
corepack prepare yarn@1.22.22 --activate
```

然后再次验证：

```bash
yarn -v
```

如果仍然没有 `yarn`，这是硬阻塞，可以向用户说明“本机缺少可用 Yarn，无法继续”，其余情况不要中断。

---

### 第 2 步：安装与构建

**首次安装时，优先执行仓库自带 bootstrap：**

```bash
cd <repo-root>
bash skills/wechat-article-exporter/scripts/bootstrap.sh
```

这个脚本会自动处理：

- 缺失 `yarn` 时尝试通过 `corepack` 激活
- 缺失 `node_modules` 时安装依赖
- 缺失 `.output/server/index.mjs` 时执行构建

注意：

- 首次构建 Nuxt 可能持续几十秒到 1 分钟以上，**不要误判为卡死**
- 不要默认改成 `npm install`
- 不要默认改成 `npm run dev`

安装后建议检查以下任一结果：

```bash
test -d node_modules && echo OK
test -f .output/server/index.mjs && echo OK
```

---

### 第 3 步：服务健康检查

安装完成后，不要先手动跑 `yarn dev`，先直接用标准 wrapper 做健康检查：

```bash
cd <repo-root>
node skills/wechat-article-exporter/scripts/wechat-exporter-skill.cjs --json '{"action":"get_current_ip"}'
```

预期结果：

- 返回单行 JSON
- 成功形态为：`{"ok":true,"data":...}`

这一步会自动：

- 必要时再次 bootstrap
- 检测 Nitro 服务是否可用
- 在 `embedded` 模式下自动拉起服务

如果成功，就说明“安装到运行”已经打通。

---

### 第 4 步：首次登录必须走标准扫码流程

如果后续 action 返回 `MISSING_AUTH_KEY`，不要让用户先手填 secret，也不要假设 auth-key 已存在，直接执行扫码登录链路。

标准顺序：

1. `session_start`
2. `login_get_qrcode`
3. 用户扫码后轮询 `login_scan_status`
4. `login_finalize`
5. `authkey_validate`

建议命令模板如下：

```bash
cd <repo-root>
node skills/wechat-article-exporter/scripts/wechat-exporter-skill.cjs --json '{"action":"session_start","sid":"session-<timestamp>"}'
node skills/wechat-article-exporter/scripts/wechat-exporter-skill.cjs --json '{"action":"login_get_qrcode"}'
```

`login_get_qrcode` 成功后会返回二维码图片文件路径。AI 应该：

- 把 `absolute_path` 告诉用户
- 如果当前客户端支持展示本地图片，就直接把该图片展示给用户扫码

扫码后轮询：

```bash
cd <repo-root>
node skills/wechat-article-exporter/scripts/wechat-exporter-skill.cjs --json '{"action":"login_scan_status"}'
```

轮询规则：

- 每 2 秒轮询一次
- 最多轮询约 60 秒
- 如果用户还没扫码，不要报错，继续等待
- 直到状态显示已确认，再执行 finalize

完成登录：

```bash
cd <repo-root>
node skills/wechat-article-exporter/scripts/wechat-exporter-skill.cjs --json '{"action":"login_finalize"}'
node skills/wechat-article-exporter/scripts/wechat-exporter-skill.cjs --json '{"action":"authkey_validate"}'
```

---

## 关于 auth-key 的正确认知

这是最容易误导 AI 的地方，必须严格按下面理解：

1. `login_finalize` 成功后，skill 会把 `auth-key` 和 cookie 自动持久化到：

```text
.data/openclaw-skill/state.json
```

2. **本地 GitHub 安装场景下，通常不需要要求用户手工再配置 `OPENCLAW_AUTH_KEY`**
   - 后续 wrapper 调用会自动复用持久化状态
   - 只有在宿主平台必须使用 Secret 注入时，才需要把 `auth_key` 显式写入 Secret

3. 不要在刚登录成功后立刻告诉用户“你还要自己去配置 auth-key”，除非当前运行环境明确要求 Secret

---

## 第 5 步：推荐业务调用顺序

登录成功后，优先用这条链路，不要自己发散：

1. `authkey_validate`
2. `add_account_search`
3. 让用户确认候选公众号
4. `add_account_sync`
5. 如需导出，再执行 `download_article`

### 搜索公众号

```bash
cd <repo-root>
node skills/wechat-article-exporter/scripts/wechat-exporter-skill.cjs --json '{"action":"add_account_search","keyword":"环球旅讯","begin":0,"size":5}'
```

AI 应从返回值中提取：

- `nickname`
- `alias`
- `fakeid`

然后让用户确认要哪一个 `fakeid`。

### 同步文章

```bash
cd <repo-root>
node skills/wechat-article-exporter/scripts/wechat-exporter-skill.cjs --json '{"action":"add_account_sync","fakeid":"<fakeid>","begin":0,"size":5,"max_pages":1}'
```

### 列表查询

```bash
cd <repo-root>
node skills/wechat-article-exporter/scripts/wechat-exporter-skill.cjs --json '{"action":"list_articles","fakeid":"<fakeid>","begin":0,"size":10}'
```

### 导出文章

```bash
cd <repo-root>
node skills/wechat-article-exporter/scripts/wechat-exporter-skill.cjs --json '{"action":"download_article","url":"https://mp.weixin.qq.com/s/xxxx","format":"markdown"}'
```

支持格式：

- `html`
- `markdown`
- `text`
- `json`

---

## 手动兜底策略

只有在 wrapper 健康检查失败时，才进入这一节。

### 兜底 1：重新执行 bootstrap

```bash
cd <repo-root>
bash skills/wechat-article-exporter/scripts/bootstrap.sh
```

然后再次执行：

```bash
node skills/wechat-article-exporter/scripts/wechat-exporter-skill.cjs --json '{"action":"get_current_ip"}'
```

### 兜底 2：手动拉起开发服务

仅当自动拉起失败时才这样做：

```bash
cd <repo-root>
yarn dev --host 127.0.0.1 --port 3000
```

另一个终端再验证：

```bash
cd <repo-root>
node skills/wechat-article-exporter/scripts/wechat-exporter-skill.cjs --json '{"action":"get_current_ip"}'
```

### 兜底 3：显式指定地址

如果服务不是默认地址，再带环境变量调用：

```bash
cd <repo-root>
NITRO_BASE_URL=http://127.0.0.1:3000 node skills/wechat-article-exporter/scripts/wechat-exporter-skill.cjs --json '{"action":"get_current_ip"}'
```

---

## AI 禁止事项

以下做法会显著降低首次安装成功率，禁止默认采用：

1. 进入 `openclaw-skill/` 子目录执行 `npm install`
2. 不跑 `bootstrap.sh`，直接猜依赖怎么装
3. 不用 wrapper，自己写 Node 代码直接 `require('./openclaw-skill/src/skill-core.cjs')`
4. 用 `curl` 绕过 skill action 调登录接口
5. 在未验证服务健康的情况下直接开始扫码流程
6. 登录成功后立刻要求用户手工设置 `OPENCLAW_AUTH_KEY`
7. 首次运行构建时间较长时，误判为“脚本卡死”

---

## 常见错误与处理

### `yarn ENOENT` / `yarn: command not found`

原因：

- Yarn 不存在，或不在 PATH 中

处理：

```bash
corepack enable
corepack prepare yarn@1.22.22 --activate
```

---

### `MISSING_AUTH_KEY`

原因：

- 当前没有可用登录态

处理：

- 直接走扫码登录流程
- 不要先要求用户配置 secret

---

### `认证信息无效`

原因：

- 持久化的登录态过期

处理：

- 重新执行扫码登录流程

---

### `UPSTREAM_UNAVAILABLE`

原因：

- Nitro 服务不可用

处理顺序：

1. 先重新执行 `bootstrap.sh`
2. 再跑 `get_current_ip`
3. 还不行再手动 `yarn dev --host 127.0.0.1 --port 3000`

---

### `NITRO_BOOT_TIMEOUT`

原因：

- 自动拉起超时，通常是依赖缺失、构建失败或端口问题

处理：

1. 确认 `node_modules` 是否存在
2. 确认 `.output/server/index.mjs` 是否存在
3. 手动执行 `bash skills/wechat-article-exporter/scripts/bootstrap.sh`
4. 如仍失败，再手动 `yarn dev`

---

## 最短成功路径

如果 AI 只保留最核心步骤，请至少按这个顺序：

```bash
cd <repo-root>
bash skills/wechat-article-exporter/scripts/bootstrap.sh
node skills/wechat-article-exporter/scripts/wechat-exporter-skill.cjs --json '{"action":"get_current_ip"}'
node skills/wechat-article-exporter/scripts/wechat-exporter-skill.cjs --json '{"action":"session_start","sid":"session-<timestamp>"}'
node skills/wechat-article-exporter/scripts/wechat-exporter-skill.cjs --json '{"action":"login_get_qrcode"}'
# 用户扫码后轮询 login_scan_status
node skills/wechat-article-exporter/scripts/wechat-exporter-skill.cjs --json '{"action":"login_finalize"}'
node skills/wechat-article-exporter/scripts/wechat-exporter-skill.cjs --json '{"action":"authkey_validate"}'
```

核心记忆点只有四个：

1. 在仓库根目录工作
2. 安装先跑 `bootstrap.sh`
3. 调用统一走 `wechat-exporter-skill.cjs`
4. 登录成功后本地会自动持久化状态，通常不用再手填 `OPENCLAW_AUTH_KEY`
