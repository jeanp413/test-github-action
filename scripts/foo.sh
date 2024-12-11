# use busybox to remove a dependency on image
ARCH="amd64"
if [ "$(uname -m)" = "aarch64" ] || [ "$(uname -m)" = "arm64" ]; then
    ARCH="arm64"
fi
AGENT_DOWNLOAD_URL="https://gitpod-flex-releases.s3.amazonaws.com/vscode/development/jpindustrial-muskox/vscode-agent-$ARCH"
AGENT_INSTALL_DIR="/usr/local/gitpod/shared/vscode/0.1.2024120801"
AGENT_INSTALL_PATH="$AGENT_INSTALL_DIR/vscode-agent"

echo ">>>SUCCESS<<<"
exit 0
