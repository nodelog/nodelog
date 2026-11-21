#!/usr/bin/env bash
# 真渲染验收：三页面 × 明暗 × 桌面/移动，共 12 张截图
# 依赖：本机 Chrome（无第三方 node/python 包）
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
ROOT="D:/code/NODELOG/design-language"
HTML="file:///D:/code/NODELOG/design-language/index.html"
OUT="$ROOT/.gates/shots"
mkdir -p "$OUT"

for page in home list article; do
  for theme in light dark; do
    for vp in desktop mobile; do
      if [ "$vp" = desktop ]; then W=1440; H=900; else W=390; H=844; fi
      name="${page}-${theme}-${vp}.png"
      "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
        --virtual-time-budget=1800 \
        --screenshot="$OUT/$name" --window-size="$W,$H" \
        "$HTML?page=$page&theme=$theme&vp=$vp" >/dev/null 2>&1
    done
  done
done

echo "--- shots ---"
ls -la "$OUT"
