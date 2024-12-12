import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';

class NativeSSH {
    sshPath;
    static version;
    commandSeq = 0;

    constructor(sshPath) {
        this.sshPath = sshPath;
    }

    getSSHConfigPath() {
        return this.sshPath || 'ssh';
    }

    execCommand(command, args, options) {
        const startTime = Date.now();
        const id = this.commandSeq++;
        console.log('ssh', id, command, ...(args || []));
        let abortController;
        let timeoutHandler;
        if (options?.timeout && options.timeout > 0) {
            abortController = new AbortController();
            timeoutHandler = setTimeout(() => abortController?.abort(), options.timeout);
        }
        const opts = {
            ...options,
            signal: abortController?.signal,
            windowsVerbatimArguments: true,
        };
        const process = cp.spawn(command, args, opts);
        const stdoutDataArr = [];
        const stderrDataArr = [];
        process.stdout.on('data', data => {
            console.log(`===> [stdout] ${data}`);
            stdoutDataArr.push(data.toString());
        });
        process.stderr.on('data', data => {
            console.log(`===> [stderr] ${data}`);
            stderrDataArr.push(data.toString());
        });
        const completed = new Promise((resolve, reject) => {
            process.on('error', err => {
                if (err.name === 'AbortError') {
                    err = new SSHCommandTimeoutError(`${command} ${(args || []).join(' ')}`, stdoutDataArr.join(''), stderrDataArr.join(''));
                }
                const duration = Date.now() - startTime;
                console.log('ssh', id, duration, 'failure', err);
                clearTimeout(timeoutHandler);
                reject(err);
            });
            process.on('close', code => {
                code = code ?? 256;
                const duration = Date.now() - startTime;
                console.log('ssh', id, duration, 'success', code);
                clearTimeout(timeoutHandler);
                resolve({ code });
            });
        });
        return {
            get stdout() {
                return stdoutDataArr.join('');
            },
            get stderr() {
                return stderrDataArr.join('');
            },
            completed,
            terminate() {
                process.kill();
            },
        };
    }

    async runSSHRemoteCommand(sshDest, command, timeout, additionalArgs) {
        const sshPath = this.getSSHConfigPath();
        // Avoid using `ConnectTimeout` as it causes ssh to try to resolve the host taking many seconds
        additionalArgs = additionalArgs ?? [];
        const host = sshDest.user ? `${sshDest.user}@${sshDest.hostname}` : sshDest.hostname;
        if (sshDest.port) {
            additionalArgs.push('-p', String(sshDest.port));
        }
        const sshArgs = ['-T', ...additionalArgs, host];
        const finalCmd = await generateSshMultilineCommand([sshPath, ...sshArgs], command, sshDest.hostname, process.platform === 'win32');
        const cmd = Array.isArray(finalCmd) ? finalCmd[0] : finalCmd;
        const cmdArgs = Array.isArray(finalCmd) ? finalCmd.slice(1) : undefined;
        let opts = { timeout };
        if (process.platform === 'win32') {
            opts = {
                ...opts,
                shell: true,
                windowsHide: true,
            };
        }
        const resp = this.execCommand(cmd, cmdArgs, opts);
        const { code } = await resp.completed;
        if (code === 0) {
            return { stdout: resp.stdout, stderr: resp.stderr };
        }
        else if (code === 256) {
            throw new SSHCommandTimeoutError(`${sshPath} ${sshArgs.join(' ')}`);
        }
        else {
            throw new NativeSSHError(`${sshPath} ${sshArgs.join(' ')}`, code, resp.stdout, resp.stderr);
        }
    }
}

class NativeSSHError extends Error {
    constructor(cmd, code, stdout, stderr) {
        super();
        this.name = 'NativeSSHError';
        this.message = `cmd: ${cmd}\ncode: ${code}\n\nstdout: ${stdout}\n\nstderr: ${stderr}`;
    }
}

class SSHCommandTimeoutError extends Error {
    constructor(cmd, stdout, stderr) {
        super();
        this.name = 'SSHCommandTimeoutError';
        this.message = `SSH command ${cmd} timeout` + (stdout ? `\n\nstdout: ${stdout}` : '') + (stderr ? `\n\nstderr: ${stderr}` : '');
    }
}

function sanitizeFileName(str) {
    return str.replace(/[^a-z0-9._]/g, '-');
}

async function generateSshMultilineCommand(sshCmd, remoteCmd, hostname, isWindows) {
    if (isWindows) {
        const salt = (0, crypto.randomInt)(1, 1e9);
        const cmdFilepath = path.join(os.tmpdir(), `ssh-proxy-multiline-cmd-${sanitizeFileName(hostname)}-${salt}.sh`);
        try {
            remoteCmd = remoteCmd.replace(/\r\n/g, '\n');
            await fs.promises.writeFile(cmdFilepath, remoteCmd);
        }
        catch (e) {
            throw new Error(`Failed to write ssh cmd script to filepath ${cmdFilepath}`);
        }
        return `cat "${cmdFilepath}" | ${sshCmd.join(' ')} sh`;
    }
    return [...sshCmd, `sh -c '${remoteCmd.replace(/'/g, `'\\''`)}'`];
}

async function main() {
    try {
        const ssh = new NativeSSH("ssh");
        const installAgentScript = `# use busybox to remove a dependency on image
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
        `;
        await ssh.runSSHRemoteCommand({ hostname: "0193b2d8-0901-722c-b519-aa9da52ab4a9.gitpod.remote" }, installAgentScript, 3 * 60 * 1000, ['-o', 'ProxyCommand=none', "-vvv"]);

        console.log(">>>>>FIN<<<<");
    } catch (e) {
        console.error(e);
    }
}

main()
