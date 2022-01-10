// with es6 imports
import { getSdk } from 'balena-sdk';
import dotenv from 'dotenv'
import { ChildProcess } from 'child_process'
import { closeTunnel, connectSSH, createBalenaTunnel, createFolder, loginBalenaShell } from './utils';
import fs from 'fs'

dotenv.config()

const KEYS_TO_ADD = JSON.parse(fs.readFileSync('./keys_to_add.json', 'utf-8'))
const ACCESS_TOKEN = process.env.ACCESS_TOKEN
const SSH_PRIVATE_KEY_PATH = process.env.SSH_PRIVATE_KEY_PATH
let currentChildProcess: null | ChildProcess = null


async function main() {
    if (ACCESS_TOKEN == null) return
    if (SSH_PRIVATE_KEY_PATH == null) return

    await createFolder()

    const balena = getSdk({
        apiUrl: "https://api.balena.iet.mw.tu-dresden.de/",
        dataDirectory: "./tmp/balena",
    });

    await balena.auth.loginWithToken(ACCESS_TOKEN)
    await loginBalenaShell(ACCESS_TOKEN)
    console.log("Logged in to shell!")
    const devices = await balena.models.device.getAll()

    console.log(`Found ${devices.length}! Online: ${devices.filter(d => d.api_heartbeat_state === 'online').length}`)
    for (const device of devices) {
        if (device.api_heartbeat_state !== 'online') continue

        try {
            console.log(`Connect to device ${device.uuid}.`)
            currentChildProcess = await createBalenaTunnel({
                uuid: device.uuid,
                onClose: async (uuid, tun, code) => {
                    console.log(`Tunnel to device ${uuid} closed! Code: ${code}`)
                },
            })
            console.log(`Tunnel to device ${device.uuid} established!`)

            // create ssh connection
            const ssh = await connectSSH(SSH_PRIVATE_KEY_PATH)

            // create a backup of the config.json
            await ssh.exec('cp', ['/mnt/boot/config.json', '/mnt/boot/backup.config.json'])

            // load config from device
            const config = JSON.parse(await ssh.exec('cat', ['/mnt/boot/config.json']))

            if (config.os == null) {
                config.os = {
                    sshKeys: []
                }
            }
            if (config.os.sshKeys == null) {
                config.os.sshKeys = []
            }

            for (const key of KEYS_TO_ADD) {
                if (config.os.sshKeys.includes(key)) continue

                config.os.sshKeys.push(key)
            }

            // load the config to the device
            await ssh.exec('echo', [JSON.stringify(config, null, 2), '>', '/mnt/boot/config.json'])

            // test the result
            const configUpdated = JSON.parse(await ssh.exec('cat', ['/mnt/boot/config.json']))
            if (JSON.stringify(config) !== JSON.stringify(configUpdated)) {
                throw new Error("Saved config is not equal to the prepared version.")
            } else {
                console.log(`Updated the config of the device ${device.uuid}`)
                // remove the backup
                await ssh.exec('rm', ['/mnt/boot/backup.config.json'])
                // restart the device
                await ssh.exec('reboot', [])
            }

            await closeTunnel({ tunnel: currentChildProcess, signal: "SIGTERM" })
            return
        } catch (err) {
            console.error(`Failed to transmit ssh key for device ${device.uuid}.`)
            console.error(err)

            if (currentChildProcess != null) {
                await closeTunnel({ tunnel: currentChildProcess, signal: "SIGTERM" })
            }
        }
    }
}

process.on('SIGINT', () => {
    if (currentChildProcess != null && currentChildProcess.pid != null) {
        console.log("\n Cleanup for exit!")
        currentChildProcess.kill("SIGTERM")
        process.kill(-currentChildProcess.pid)
    }
})

main()
