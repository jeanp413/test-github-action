import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';

const __dirname = import.meta.dirname;

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
        // const salt = (0, crypto.randomInt)(1, 1e9);
        // const cmdFilepath = path.join(os.tmpdir(), `ssh-proxy-multiline-cmd-${sanitizeFileName(hostname)}-${salt}.sh`);
        // try {
        //     remoteCmd = remoteCmd.replace(/\r\n/g, '\n');
        //     await fs.promises.writeFile(cmdFilepath, remoteCmd);
        // }
        // catch (e) {
        //     throw new Error(`Failed to write ssh cmd script to filepath ${cmdFilepath}`);
        // }
        return `type "${path.join(__dirname, "foo.sh")}" | ${sshCmd.join(' ')} sh`;
    }
    return [...sshCmd, `sh -c '${remoteCmd.replace(/'/g, `'\\''`)}'`];
}

async function exists(path) {
    try {
        await fs.promises.access(path);
        return true;
    } catch {
        return false;
    }
}

// const sshFolder = path.join(os.homedir(), ".ssh");
// if (!exists(sshFolder)) {
//     await fs.promises.mkdir(sshFolder, { recursive: true });
// }

// const sshConfig = path.join(sshFolder, "config");
const sshConfig = path.join(__dirname, "config")
await fs.promises.writeFile(sshConfig, `
Host 0193b2d8-0901-722c-b519-aa9da52ab4a9.gitpod.remote
    User gitpod_devcontainer
    Port 22
    HostName ec2-18-197-143-102.eu-central-1.compute.amazonaws.com
    IdentityFile ${path.join(__dirname, "gp_ssh_key")}
    IdentitiesOnly yes
    Compression yes
    ServerAliveInterval 300
    ServerAliveCountMax 5
    Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes256-ctr
    ConnectTimeout 0
`, {});
// await fs.promises.copyFile(path.join(__dirname, "gp_ssh_key"), path.join(sshFolder,"gp_ssh_key"))
// await fs.promises.copyFile(path.join(__dirname, "gp_ssh_key.pub"), path.join(sshFolder,"gp_ssh_key.pub"))


const ssh = new NativeSSH("ssh");
const installAgentScriptOutput = await ssh.runSSHRemoteCommand({ hostname: "0193b2d8-0901-722c-b519-aa9da52ab4a9.gitpod.remote" }, "foo", 1 * 60 * 1000, ['-o', 'ProxyCommand=none', "-F", sshConfig, "-vvv"]);
console.log(`installAgentScriptOutput output: `, installAgentScriptOutput.stderr + '\n\n' + installAgentScriptOutput.stdout);
