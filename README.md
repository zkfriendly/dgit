# dgit
decentralised git forge!

# node
we use [Haxy](https://github.com/zkfriendly/haxy.git) as a git server

so first cd into `node` directory and build the haxy node. 

```
cd node
```

Then follow the readme to run the git server node

# ENS + AXL bridge

## Docker

Build the runtime image:

```sh
docker build -t dgit .
```

Run the full stack with one container:

```sh
docker run --rm \
  -p 8090:8090 \
  -v dgit-data:/data \
  -e PRIVATE_KEY="$PRIVATE_KEY" \
  dgit
```

`PRIVATE_KEY` is the only required value for claiming new `*.git.eth` names.
The image defaults Sepolia RPC, registrar, AXL peers, Haxy, and bridge endpoints.
Set `DGIT_PUBLIC_ENDPOINT` if other machines should use a hostname different
from `127.0.0.1:8090`.

Push and pull through the bridge:

```sh
git remote add origin http://127.0.0.1:8090/myrepo@git.eth
git push origin HEAD:master
git clone http://127.0.0.1:8090/myrepo@git.eth
```

Run the Docker smoke test with:

```sh
PRIVATE_KEY="$PRIVATE_KEY" scripts/docker_smoke_test.sh
```

## Manual

With Haxy and the AXL node running, start the bridge:

```sh
python3 scripts/dgit_axl_bridge.py --listen 127.0.0.1:8090
```

The bridge shells out to Foundry's `cast` for ENS calls. It auto-detects
`cast` on `PATH` or at `~/.foundry/bin/cast`; override with `CAST_BIN` or
`--cast-bin` if needed.

Push through the bridge with an ENS-style repo path:

```sh
git remote add origin http://127.0.0.1:8090/myrepo@git.eth
git push origin HEAD:master
```

On receive-pack requests the bridge claims `myrepo.git.eth` if it is unclaimed
and writes the local AXL public key to ENS text record `dgit.axl.public_key`.
Pulls resolve that text record and proxy git smart HTTP either to the local Haxy
server or to the resolved peer through AXL.
