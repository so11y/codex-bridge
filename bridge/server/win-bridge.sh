#!/bin/sh
# win - execute a command on the user's computer through the bridge (socket + TLS).
# Interface-compatible replacement for the SSH-based win:
#   win <command...>      (argv)
#   win - < script        (command from stdin)
# Exit code is propagated from the remote command.
set -u

BRIDGE_CLI=${BRIDGE_CLI:-"$HOME/bridge/bridge-cli.js"}
NODE_BIN=${BRIDGE_NODE:-"$HOME/.local/node/bin/node"}
CLIENT=${BRIDGE_CLIENT:-zr-pc}

if [ "${1:-}" = "-" ]; then
  cmd=$(cat)
elif [ "$#" -gt 0 ]; then
  cmd="$*"
else
  printf '%s\n' 'usage: win <command...> | win - < script' >&2
  exit 2
fi

# 可选：把服务器侧的 cwd 映射成客户端路径（WIN_CWD 以 ~/win 开头时）
# 目前直接使用客户端默认工作目录，需要指定目录时在命令里自行 cd。
"$NODE_BIN" "$BRIDGE_CLI" exec --client "$CLIENT" -- "$cmd"
exit $?
