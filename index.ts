// with es6 imports
import { getSdk } from 'balena-sdk';
import dotenv from 'dotenv'
import { ChildProcess } from 'child_process'
import { closeTunnel, connectSSH, createBalenaTunnel, createFolder, loginBalenaShell, sleep } from './utils';
import options from './options.json'

dotenv.config()

const FLEETS: Array<string> = options.fleets || []
const DEVICES: Array<string> = options.devices || []
const BLACKLIST: Array<string> = options.blacklist || []
const KEYS: Array<string> = options.keys || []
const ACCESS_TOKEN = process.env.ACCESS_TOKEN
const SSH_PRIVATE_KEY_PATH = process.env.SSH_PRIVATE_KEY_PATH
const BALENA_API_HOST = process.env.BALENA_API_HOST
const BOOT_FOLDER = "/mnt/boot"
const CONFIG_FILE_NAME = 'config.json'
const BACKUP_CONFIG_FILE_NAME = `backup.${CONFIG_FILE_NAME}`
let currentChildProcess: null | ChildProcess = null


async function main() {
    if (FLEETS.length > 0 && DEVICES.length > 0) throw new Error("You can only define boxes per fleet or per uuid, but not both at once.")
    if (FLEETS.length === 0 && DEVICES.length === 0) throw new Error("You defined no fleets and no device uuids.")
    if (KEYS.length === 0) throw new Error("Found no keys in the options.json.")
    if (BALENA_API_HOST == null) throw new Error("We need the url of your balena instance.")
    if (ACCESS_TOKEN == null) throw new Error("We need a access token to get all accable devices.")
    if (SSH_PRIVATE_KEY_PATH == null) throw new Error("We need the path to the ssh private key, to create a SSH-Connection.")

    await createFolder()

    const balena = getSdk({
        apiUrl: BALENA_API_HOST,
        dataDirectory: "./tmp/balena",
    });

    await balena.auth.loginWithToken(ACCESS_TOKEN)
    await loginBalenaShell(ACCESS_TOKEN)
    console.log("Logged in to balena!")
    const devices = await balena.models.device.getAll()

    console.log(`Found ${devices.length} Devices! Online: ${devices.filter(d => d.api_heartbeat_state === 'online').length}`)
    console.log("Start to deploy the keys!")
    for (const device of devices) {
        const deviceName = device.device_name
        const shortUuid = device.uuid.slice(0, 7)
        const logPrefix = `[${shortUuid}]: ${deviceName}`.padEnd(25).slice(0, 25) + ' - '
        let tunnelConnected = false

        // skip the device it it stands on the blacklist
        if (BLACKLIST.includes(device.uuid)) continue

        // skip the device if it not stands on the device list
        if (DEVICES.length > 0 && !DEVICES.includes(device.uuid)) continue

        if (FLEETS.length > 0) {
            // skip the device if it not belongs to the defined fleets/application
            const applicationName = await balena.models.device.getApplicationName(device.id)
            if (!FLEETS.includes(applicationName)) continue
        }

        if (device.api_heartbeat_state !== 'online') {
            console.log(logPrefix, 'Device is offline. Skip the deploying.')
            continue
        }

        try {
            console.log(logPrefix, 'Connect to device.')
            currentChildProcess = await createBalenaTunnel({
                uuid: device.uuid,
                onClose: async (uuid, tun, code) => {
                    console.log(logPrefix, 'Tunnel to device closed!')
                    tunnelConnected = false
                },
            })
            console.log(logPrefix, 'Tunnel to device established!')
            tunnelConnected = true

            // create ssh connection
            const ssh = await connectSSH(SSH_PRIVATE_KEY_PATH)

            // create a backup of the config.json
            await ssh.exec('cp', [CONFIG_FILE_NAME, BACKUP_CONFIG_FILE_NAME], { cwd: BOOT_FOLDER })

            // load config from device
            const config = JSON.parse(await ssh.exec('cat', [CONFIG_FILE_NAME], { cwd: BOOT_FOLDER }))

            if (config.os == null) {
                config.os = {
                    sshKeys: []
                }
            }
            if (config.os.sshKeys == null) {
                config.os.sshKeys = []
            }

            let addedKeys = false
            for (const key of KEYS) {
                if (config.os.sshKeys.includes(key)) continue

                config.os.sshKeys.push(key)
                addedKeys = true
            }

            if (!addedKeys) {
                console.log(logPrefix, 'All keys already deployed. Continue to next.')
                await closeTunnel({ tunnel: currentChildProcess, signal: "SIGTERM" })
                continue
            }

            // load the config to the device
            await ssh.execCommand(`echo '${JSON.stringify(config)}' > ${CONFIG_FILE_NAME}`, { cwd: BOOT_FOLDER })

            // test the result
            const configUpdated = JSON.parse(await ssh.exec('cat', [CONFIG_FILE_NAME], { cwd: BOOT_FOLDER }))
            if (JSON.stringify(config) !== JSON.stringify(configUpdated)) {
                throw new Error("Saved config is not equal to the prepared version.")
            } else {
                console.log(logPrefix, 'Updated the config of the device.')
                // remove the backup
                await ssh.exec('rm', [BACKUP_CONFIG_FILE_NAME], { cwd: BOOT_FOLDER })
                // restart the device
                await ssh.execCommand('reboot')
            }
        } catch (err) {
            console.error(logPrefix, 'Failed to transmit ssh key for device.')
            console.error(err)
        } finally {
            if (currentChildProcess != null) {
                await closeTunnel({ tunnel: currentChildProcess, signal: "SIGTERM" })
                const now = Date.now()

                while (tunnelConnected) {
                    if (Date.now() - now > 60000) {
                        console.error(logPrefix, "Failed to close tunnel. Try to kill proxy tunnel.")
                        break
                    }
                    await sleep(100)
                }

                await closeTunnel({ tunnel: currentChildProcess, signal: "SIGKILL" })
                while (tunnelConnected) {
                    if (Date.now() - now > 60000) {
                        console.error(logPrefix, "Failed to close tunnel. Try to kill proxy tunnel.")
                        throw Error("Close Tunnel failed.")
                    }
                    await sleep(100)
                }
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
