#!/bin/bash
# Overlay Studio 启动器:双击 → 起服务(如未运行)+ 用 Chrome 打开
# 用脚本自己所在的目录,不写死路径 —— 写死的话别人下载下来双击必然直接退出
cd "$(dirname "$0")" || exit 1

open_studio() {
  open -a "Google Chrome" "http://localhost:5177/" 2>/dev/null || open "http://localhost:5177/"
}

if curl -s -o /dev/null --max-time 1 http://localhost:5177/; then
  open_studio
  exit 0
fi

open_studio &
npm run dev
