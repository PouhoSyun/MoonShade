#!/usr/bin/env bash
set -euo pipefail

# 用法：./upload_to_server.sh 1.12.3 [说明]
# 以版本号开头时，会先同步到首页 public/index.html 的版本显示，再提交和部署。

GIT_MESSAGE="${*:-}"
INDEX_FILE="public/index.html"

if [[ -z "$GIT_MESSAGE" ]]; then
  read -r -p "Git commit message: " GIT_MESSAGE
fi

if [[ -z "$GIT_MESSAGE" ]]; then
  echo "Missing git commit message."
  exit 1
fi

if [[ "$GIT_MESSAGE" =~ ^v?([0-9]+\.[0-9]+\.[0-9]+)([[:space:]]|$) ]]; then
  VERSION="${BASH_REMATCH[1]}"
  if ! grep -q '<small class="app-version">version [^<]*</small>' "$INDEX_FILE"; then
    echo "Version label not found in $INDEX_FILE."
    exit 1
  fi
  VERSION="$VERSION" perl -pi -e 's{(<small class="app-version">version )[^<]*(</small>)}{$1$ENV{VERSION}$2}' "$INDEX_FILE"
  echo "Homepage version set to $VERSION."
else
  echo "No leading version number (e.g. 1.12.3); homepage version unchanged."
fi

git add .

if git diff --cached --quiet; then
  echo "No local changes to commit."
else
  git commit -m "$GIT_MESSAGE"
  git push origin main
fi

ssh root@192.3.179.244 'cd /root/MoonShade && git pull origin main && systemctl restart moonshade && systemctl status moonshade --no-pager'
