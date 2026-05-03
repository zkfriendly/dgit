// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IENSRegistry {
    function owner(bytes32 node) external view returns (address);
}

interface INameWrapper {
    function ens() external view returns (IENSRegistry);

    function setSubnodeOwner(bytes32 node, string calldata label, address newOwner, uint32 fuses, uint64 expiry)
        external
        returns (bytes32);

    function setSubnodeRecord(
        bytes32 node,
        string calldata label,
        address owner,
        address resolver,
        uint64 ttl,
        uint32 fuses,
        uint64 expiry
    ) external returns (bytes32);

    function getData(uint256 id) external view returns (address owner, uint32 fuses, uint64 expiry);
}

interface ITextResolver {
    function setText(bytes32 node, string calldata key, string calldata value) external;
}

contract GitSubnameRegistrar {
    bytes4 private constant ERC165_INTERFACE_ID = 0x01ffc9a7;
    bytes4 private constant ERC1155_RECEIVER_INTERFACE_ID = 0x4e2312e0;

    struct TextRecord {
        string key;
        string value;
    }

    error EmptyLabel();
    error InvalidLabel();
    error ParentNotWrapped();
    error AlreadyClaimed(bytes32 node);
    error EmptyTextKey();

    event NameClaimed(bytes32 indexed node, string label, address indexed owner);
    event TextRecordSet(bytes32 indexed node, string key, string value);

    INameWrapper public immutable nameWrapper;
    IENSRegistry public immutable ens;
    ITextResolver public immutable resolver;
    bytes32 public immutable parentNode;

    constructor(INameWrapper nameWrapper_, bytes32 parentNode_, ITextResolver resolver_) {
        nameWrapper = nameWrapper_;
        ens = nameWrapper_.ens();
        parentNode = parentNode_;
        resolver = resolver_;
    }

    function claim(string calldata label, TextRecord[] calldata textRecords) external returns (bytes32 node) {
        _validateLabel(label);

        bytes32 labelhash = keccak256(bytes(label));
        node = keccak256(abi.encodePacked(parentNode, labelhash));
        (address wrappedOwner,, uint64 parentExpiry) = nameWrapper.getData(uint256(parentNode));
        if (wrappedOwner == address(0)) revert ParentNotWrapped();

        (address currentOwner,,) = nameWrapper.getData(uint256(node));
        if (currentOwner != address(0) || ens.owner(node) != address(0)) {
            revert AlreadyClaimed(node);
        }

        nameWrapper.setSubnodeOwner(parentNode, label, address(this), 0, parentExpiry);

        for (uint256 i = 0; i < textRecords.length; i++) {
            if (bytes(textRecords[i].key).length == 0) revert EmptyTextKey();
            resolver.setText(node, textRecords[i].key, textRecords[i].value);
            emit TextRecordSet(node, textRecords[i].key, textRecords[i].value);
        }

        nameWrapper.setSubnodeRecord(parentNode, label, msg.sender, address(resolver), 0, 0, parentExpiry);

        emit NameClaimed(node, label, msg.sender);
    }

    function _validateLabel(string calldata label) private pure {
        bytes calldata labelBytes = bytes(label);
        if (labelBytes.length == 0) revert EmptyLabel();

        for (uint256 i = 0; i < labelBytes.length; i++) {
            bytes1 char = labelBytes[i];
            if (char == "." || char == 0x00) revert InvalidLabel();
        }
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == ERC165_INTERFACE_ID || interfaceId == ERC1155_RECEIVER_INTERFACE_ID;
    }
}
