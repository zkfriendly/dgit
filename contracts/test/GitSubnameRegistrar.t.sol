// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {GitSubnameRegistrar, IENSRegistry, INameWrapper, ITextResolver} from "../src/GitSubnameRegistrar.sol";

contract MockENSRegistry is IENSRegistry {
    mapping(bytes32 node => address owner) public owners;

    function owner(bytes32 node) external view returns (address) {
        return owners[node];
    }

    function setOwner(bytes32 node, address owner_) external {
        owners[node] = owner_;
    }
}

contract MockNameWrapper is INameWrapper {
    struct NameData {
        address owner;
        uint32 fuses;
        uint64 expiry;
    }

    MockENSRegistry public immutable registry;
    mapping(uint256 id => NameData data) public names;

    constructor(MockENSRegistry registry_) {
        registry = registry_;
    }

    function ens() external view returns (IENSRegistry) {
        return registry;
    }

    function setName(bytes32 node, address owner, uint32 fuses, uint64 expiry) external {
        names[uint256(node)] = NameData(owner, fuses, expiry);
        registry.setOwner(node, address(this));
    }

    function setSubnodeOwner(bytes32 node, string calldata label, address newOwner, uint32 fuses, uint64 expiry)
        external
        returns (bytes32)
    {
        bytes32 childNode = _childNode(node, label);
        names[uint256(childNode)] = NameData(newOwner, fuses, expiry);
        registry.setOwner(childNode, address(this));
        return childNode;
    }

    function setSubnodeRecord(
        bytes32 node,
        string calldata label,
        address owner,
        address,
        uint64,
        uint32 fuses,
        uint64 expiry
    ) external returns (bytes32) {
        bytes32 childNode = _childNode(node, label);
        names[uint256(childNode)] = NameData(owner, fuses, expiry);
        registry.setOwner(childNode, address(this));
        return childNode;
    }

    function getData(uint256 id) external view returns (address owner, uint32 fuses, uint64 expiry) {
        NameData memory data = names[id];
        return (data.owner, data.fuses, data.expiry);
    }

    function _childNode(bytes32 node, string calldata label) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(node, keccak256(bytes(label))));
    }
}

contract MockTextResolver is ITextResolver {
    MockNameWrapper public immutable wrapper;
    mapping(bytes32 node => mapping(string key => string value)) public records;

    constructor(MockNameWrapper wrapper_) {
        wrapper = wrapper_;
    }

    function setText(bytes32 node, string calldata key, string calldata value) external {
        (address owner,,) = wrapper.getData(uint256(node));
        require(owner == msg.sender, "not owner");
        records[node][key] = value;
    }

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        return records[node][key];
    }
}

contract GitSubnameRegistrarTest is Test {
    bytes32 internal constant ETH_NODE = 0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae;
    uint64 internal constant PARENT_EXPIRY = 1_800_000_000;

    MockENSRegistry internal ens;
    MockNameWrapper internal wrapper;
    MockTextResolver internal resolver;
    GitSubnameRegistrar internal registrar;
    bytes32 internal parentNode;

    function setUp() public {
        ens = new MockENSRegistry();
        wrapper = new MockNameWrapper(ens);
        resolver = new MockTextResolver(wrapper);

        parentNode = keccak256(abi.encodePacked(ETH_NODE, keccak256(bytes("git"))));
        wrapper.setName(parentNode, address(this), 0, PARENT_EXPIRY);

        registrar = new GitSubnameRegistrar(wrapper, parentNode, resolver);
    }

    function testClaimSetsOwnerResolverAndTextRecords() public {
        GitSubnameRegistrar.TextRecord[] memory records = new GitSubnameRegistrar.TextRecord[](2);
        records[0] = GitSubnameRegistrar.TextRecord("url", "https://example.com/alice.git.eth");
        records[1] = GitSubnameRegistrar.TextRecord("description", "Alice repo namespace");

        address alice = makeAddr("alice");
        vm.prank(alice);
        bytes32 node = registrar.claim("alice", records);

        (address owner,, uint64 expiry) = wrapper.getData(uint256(node));
        assertEq(owner, alice);
        assertEq(expiry, PARENT_EXPIRY);
        assertEq(ens.owner(node), address(wrapper));
        assertEq(resolver.text(node, "url"), "https://example.com/alice.git.eth");
        assertEq(resolver.text(node, "description"), "Alice repo namespace");
    }

    function testCannotClaimTakenName() public {
        GitSubnameRegistrar.TextRecord[] memory records = new GitSubnameRegistrar.TextRecord[](0);
        registrar.claim("alice", records);

        vm.expectRevert();
        registrar.claim("alice", records);
    }

    function testRejectsEmptyLabel() public {
        GitSubnameRegistrar.TextRecord[] memory records = new GitSubnameRegistrar.TextRecord[](0);

        vm.expectRevert(GitSubnameRegistrar.EmptyLabel.selector);
        registrar.claim("", records);
    }

    function testRejectsDottedLabel() public {
        GitSubnameRegistrar.TextRecord[] memory records = new GitSubnameRegistrar.TextRecord[](0);

        vm.expectRevert(GitSubnameRegistrar.InvalidLabel.selector);
        registrar.claim("alice.git", records);
    }

    function testRejectsEmptyTextKey() public {
        GitSubnameRegistrar.TextRecord[] memory records = new GitSubnameRegistrar.TextRecord[](1);
        records[0] = GitSubnameRegistrar.TextRecord("", "value");

        vm.expectRevert(GitSubnameRegistrar.EmptyTextKey.selector);
        registrar.claim("alice", records);
    }
}
