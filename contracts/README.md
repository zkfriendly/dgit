# dgit contracts

Minimal Foundry project for ENS-related dgit contracts.

## GitSubnameRegistrar

`GitSubnameRegistrar` lets anyone claim an unclaimed subname under one configured parent, intended for `git.eth` on Sepolia.

The registrar is free and first-come first-served:

- the caller becomes the owner of `<label>.git.eth`
- the registrar temporarily owns the wrapped subname only long enough to set resolver text records
- duplicate claims are rejected
- labels cannot be empty and cannot contain `.`

For Sepolia, deploy with:

```sh
source ../.env
forge script script/DeployGitSubnameRegistrar.s.sol:DeployGitSubnameRegistrar \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast
```

After deploying, `git.eth` must be wrapped and the deployed registrar must be approved as an operator on the ENS Name Wrapper with `setApprovalForAll(registrar, true)`.
## Foundry

**Foundry is a blazing fast, portable and modular toolkit for Ethereum application development written in Rust.**

Foundry consists of:

- **Forge**: Ethereum testing framework (like Truffle, Hardhat and DappTools).
- **Cast**: Swiss army knife for interacting with EVM smart contracts, sending transactions and getting chain data.
- **Anvil**: Local Ethereum node, akin to Ganache, Hardhat Network.
- **Chisel**: Fast, utilitarian, and verbose solidity REPL.

## Documentation

https://book.getfoundry.sh/

## Usage

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

### Format

```shell
$ forge fmt
```

### Gas Snapshots

```shell
$ forge snapshot
```

### Anvil

```shell
$ anvil
```

### Deploy

```shell
$ forge script script/Counter.s.sol:CounterScript --rpc-url <your_rpc_url> --private-key <your_private_key>
```

### Cast

```shell
$ cast <subcommand>
```

### Help

```shell
$ forge --help
$ anvil --help
$ cast --help
```
