# use busybox to remove a dependency on image
if [ -z "$(which mkdir 2>/dev/null)" ]; then
    alias mkdir="/usr/local/gitpod/shared/busybox mkdir"
fi
if [ -z "$(which rm 2>/dev/null)" ]; then
    alias rm="/usr/local/gitpod/shared/busybox rm"
fi
if [ -z "$(which wget 2>/dev/null)" ]; then
    alias wget="/usr/local/gitpod/shared/busybox wget"
fi
if [ -z "$(which uname 2>/dev/null)" ]; then
    alias uname="/usr/local/gitpod/shared/busybox uname"
fi
if [ -z "$(which chmod 2>/dev/null)" ]; then
    alias chmod="/usr/local/gitpod/shared/busybox chmod"
fi

ARCH="amd64"
if [ "$(uname -m)" = "aarch64" ] || [ "$(uname -m)" = "arm64" ]; then
    ARCH="arm64"
fi
AGENT_DOWNLOAD_URL="https://gitpod-flex-releases.s3.amazonaws.com/vscode/development/jpindustrial-muskox/vscode-agent-$ARCH"
AGENT_INSTALL_DIR="/usr/local/gitpod/shared/vscode/0.1.2024120801"
AGENT_INSTALL_PATH="$AGENT_INSTALL_DIR/vscode-agent"

# Ensure only one instance of script is running
LOCK_DIR=/tmp/vscode-agent-script.lock
if mkdir "$LOCK_DIR" 2>/dev/null; then
    trap 'rm -rf "$LOCK_DIR"' EXIT
else
    echo "Lock file already exist. Another instance is already running."
    echo ">>>SUCCESS<<<"
    exit 0
fi

if [ ! -f "$AGENT_INSTALL_PATH" ]; then
    if [ ! -d "$AGENT_INSTALL_DIR" ]; then
        mkdir -p "$AGENT_INSTALL_DIR"
        if [ $? -ne 0 ]; then
            echo "Error creating agent install directory"
            exit 0
        fi
    fi

    wget -O "$AGENT_INSTALL_PATH" "$AGENT_DOWNLOAD_URL" --tries=3 --timeout=15 --quiet
    if [ ! -f "$AGENT_INSTALL_PATH" ]; then
        echo "Error downloading agent."
        exit 0
    fi
    chmod +x "$AGENT_INSTALL_PATH"
fi

"$AGENT_INSTALL_PATH" configure "f1a4fb101478ce6ec82fe9627c43efbf9e98c813" "stable" "0.1.2024120801" "https://gitpod-flex-releases.s3.amazonaws.com/vscode/development/jpindustrial-muskox"
if [ $? -ne 0 ]; then
    echo "Error configuring VS Code."
    exit 0
fi

echo ">>>SUCCESS<<<"
exit 0
