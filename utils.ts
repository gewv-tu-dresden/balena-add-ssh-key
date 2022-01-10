import { spawn, exec, ChildProcess } from 'child_process'

type balenaTunnelOptions = {
    uuid: string,
    onClose: (uuid: string, proc: ChildProcess, code: number | null) => Promise<void>,
}

type closeTunnelOptions = {
    tunnel: ChildProcess,
    signal?: number | NodeJS.Signals
}

export async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function loginBalenaShell(token: string): Promise<void> {
    return new Promise((res, rej) => {
        const child = exec(`balena login --token ${token}`)
        if (child.stdout != null) {
            child.stdout.pipe(process.stdout)
        }
        child.on('exit', function () {
            res()
        })
        child.on('error', function (error) {
            rej(error.message)
        })
    })
}

export async function createBalenaTunnel({ uuid, onClose }: balenaTunnelOptions): Promise<ChildProcess> {
    return new Promise((res, rej) => {
        const bTunnel = spawn('balena', ['tunnel', uuid, '-p 22222'], { detached: true })

        bTunnel.stdout.on("data", data => {
            console.log(`[tunnel - ${uuid.slice(0, 7)}]${data}`);

            if (data.includes("Waiting for connections...")) {
                res(bTunnel)
            }
        });

        bTunnel.stderr.on("data", data => {
            console.log(`[error - tunnel - ${uuid.slice(0, 7)}]${data}`);

            if (data.includes("No ports are valid for tunnelling")) {
                rej("The target port 22222 is already in use!")
            }
        });

        bTunnel.on('error', (error) => {
            rej(error.message)
        });

        bTunnel.on('exit', (code) => {
            if (bTunnel.pid != null) {
                process.kill(-bTunnel.pid)
            }
        })

        bTunnel.on("close", code => {
            onClose(uuid, bTunnel, code)
        });
    })
}



export async function closeTunnel({ tunnel, signal }: closeTunnelOptions): Promise<void> {
    console.log("Try to close the tunnel!")
    tunnel.kill(signal)

    while (!tunnel.killed) {
        await sleep(100)
    }

    console.log("Tunnel closed!")
    return
}