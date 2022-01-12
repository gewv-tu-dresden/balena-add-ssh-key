# Add SSHKey to Balena Device Script

## How to use

You need a:

- Node
- Yarn
- SSH

Install deps with `yarn install`. Then you have to create two files. A `.env` to hold the two relevant variables:

```
ACCESS_TOKEN=****************
SSH_PRIVATE_KEY_PATH=/key/to/ssh/private/key
```

The access token is the access token for the balena service. The same you use for the balena-cli. Maybe you have to create a token. The private ssh key is that part of the key pair, that is already on device.
The second file you have to create is a `options.json`. That json has the following structur and holds the information, what keys should be add and on which device. You can define the boxes directly per uuid in the array `devices` or with the application or fleetname in the array `fleets`. But it is not possible to use both ways.

```json
{
    "devices": [
        "device_uuid",
        ...
    ],
    "fleets": [
        "Application_1",
        ...
    ],
    "blacklist": [
        "devices_that_will_skipped",
        ...
    ],
    "keys": [
        "a-public-ssh-key",
        ...
    ]
}
```

After you created the files you can start the script with the command `yarn start`.
