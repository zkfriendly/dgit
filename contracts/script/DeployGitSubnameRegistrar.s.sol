// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {GitSubnameRegistrar, INameWrapper, ITextResolver} from "../src/GitSubnameRegistrar.sol";

contract DeployGitSubnameRegistrar is Script {
    bytes32 internal constant ETH_NODE = 0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae;
    address internal constant SEPOLIA_NAME_WRAPPER = 0x0635513f179D50A207757E05759CbD106d7dFcE8;
    address internal constant SEPOLIA_PUBLIC_RESOLVER = 0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5;

    function run() external returns (GitSubnameRegistrar registrar) {
        bytes32 gitNode = keccak256(abi.encodePacked(ETH_NODE, keccak256(bytes("git"))));

        vm.startBroadcast();
        registrar = new GitSubnameRegistrar(
            INameWrapper(SEPOLIA_NAME_WRAPPER), gitNode, ITextResolver(SEPOLIA_PUBLIC_RESOLVER)
        );
        vm.stopBroadcast();
    }
}
