import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";

class NativeSSHError extends Error {
    constructor(code, stdout, stderr) {
        super();
        this.name = "NativeSSHError";
        this.message = `code: ${code}\n\nstdout: ${stdout}\n\nstderr: ${stderr}`;
    }
}

class SSHCommandTimeoutError extends Error {
    constructor(stdout, stderr) {
        super();
        this.name = "SSHCommandTimeoutError";
        this.message =
            `SSH command timeout` + (stdout ? `\n\nstdout: ${stdout}` : "") + (stderr ? `\n\nstderr: ${stderr}` : "");
    }
}

function execCommand(command, args, options) {
    let abortController;
    if (options?.timeout && options.timeout > 0) {
        abortController = new AbortController();
        setTimeout(() => abortController?.abort(), options.timeout);
    }
    const process = cp.spawn(command, args, {
        ...options,
        windowsVerbatimArguments: true,
        signal: abortController?.signal,
    });
    const stdoutDataArr = [];
    const stderrDataArr = [];
    process.stdout.on("data", (data) => {
        stdoutDataArr.push(data.toString());
    });
    process.stderr.on("data", (data) => {
        stderrDataArr.push(data.toString());
    });
    const completed = new Promise((resolve, reject) => {
        process.on("error", (err) => {
            if (err.name === "AbortError") {
                err = new SSHCommandTimeoutError(stdoutDataArr.join(""), stderrDataArr.join(""));
            }
            reject(err);
        });
        process.on("close", (code) => {
            resolve({ code: code ?? 256 });
        });
    });
    return {
        get stdout() {
            return stdoutDataArr.join("");
        },
        get stderr() {
            return stderrDataArr.join("");
        },
        completed,
        terminate() {
            process.kill();
        },
    };
}

async function generateSSHKey(filePath) {
    const resp = execCommand("ssh-keygen", ["-t", "ed25519", "-f", filePath, "-q", "-N", `""`], { timeout: 5000 });
    const { code } = await resp.completed;

    switch (code) {
        case 0:
            return;
        case 256:
            throw new SSHCommandTimeoutError();
        default:
            throw new NativeSSHError(code, resp.stdout, resp.stderr);
    }
}

async function main() {
    try {
        const currentDir = process.cwd();
        const filepath = path.join(currentDir, "foo");
    
        await generateSSHKey(filepath);

        const content = await fs.promises.readFile(filepath, 'utf8');
        console.log(content);
        
    } catch (error) {
        console.error(error);
    }
}

main()