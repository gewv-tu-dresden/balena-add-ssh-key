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
The second file you have to create is a `keys_to_add.json`. That json is only a string array with all keys, you want to add to the devices.
After you created the files you can start the script with the command `yarn start`.
