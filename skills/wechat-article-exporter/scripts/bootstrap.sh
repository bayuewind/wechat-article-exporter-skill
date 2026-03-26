#!/usr/bin/env bash
set -euo pipefail

QUIET="${1:-}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MARKER_DIR="$ROOT_DIR/.data/openclaw-skill"
MARKER_FILE="$MARKER_DIR/bootstrap.done"

log() {
  if [[ "$QUIET" != "--quiet" ]]; then
    echo "[wechat-exporter-skill] $1"
  fi
}

if ! command -v node >/dev/null 2>&1; then
  echo "node 未安装，无法使用 wechat-article-exporter skill" >&2
  exit 1
fi

if ! command -v yarn >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    log "yarn 未找到，尝试通过 corepack 激活 yarn@1.22.22"
    corepack enable >/dev/null 2>&1 || true
    corepack prepare yarn@1.22.22 --activate >/dev/null 2>&1 || true
  fi
fi

if ! command -v yarn >/dev/null 2>&1; then
  echo "yarn 不可用，请先安装 Yarn 1.22.22（或启用 corepack）" >&2
  exit 1
fi

mkdir -p "$MARKER_DIR"

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  log "安装项目依赖（首次可能较慢）"
  cd "$ROOT_DIR"
  yarn install --frozen-lockfile || yarn install
fi

if [[ ! -f "$ROOT_DIR/.output/server/index.mjs" ]]; then
  log "构建 Nitro 产物（用于 embedded 模式秒级启动）"
  cd "$ROOT_DIR"
  yarn build
fi

date -u +"%Y-%m-%dT%H:%M:%SZ" > "$MARKER_FILE"
log "bootstrap 完成"
