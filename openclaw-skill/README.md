# OpenClaw Local Skill

本目录把 `wechat-article-exporter` 封装为 OpenClaw 可调用的本地 Skill。

## 目录结构

- `manifest.yaml`: Skill 元信息、配置和输入输出 schema
- `SKILL.md`: 行为说明与 action 约定
- `src/index.cjs`: OpenClaw 入口
- `src/skill-core.cjs`: 核心实现（Nitro 托管、API 调用、校验、导出）

## 配置项

- `NITRO_BASE_URL`: 默认 `http://127.0.0.1:3000`
- `NITRO_BOOT_MODE`: `embedded | external`，默认 `embedded`
- `OPENCLAW_AUTH_KEY`: 必填 secret，用于登录态接口
- `OPENCLAW_AUTH_KEY`: 可选；未配置时会读取 `.data/openclaw-skill/state.json` 中自动持久化的 auth-key
- `NITRO_START_COMMAND`: 可选自定义启动命令

## 行为说明

- `NITRO_BOOT_MODE=embedded` 时：
  - 先探测 `NITRO_BASE_URL` 健康状态。
  - 不可达时自动拉起 Nitro（优先 `.output/server/index.mjs`，否则 `yarn dev`）。
  - 请求失败时会尝试一次自动重启。
- 下载/二维码输出：
  - 写入 `.data/openclaw-exports/<yyyyMMdd-HHmmss>/`
  - 返回 `absolute_path`、`size_bytes`、`summary`

## 本地测试

```bash
yarn test:openclaw-skill
```

可选集成测试（需准备有效 auth-key 与运行中的服务）：

```bash
OPENCLAW_INTEGRATION=1 OPENCLAW_AUTH_KEY=xxxx yarn test:openclaw-skill:integration
```
