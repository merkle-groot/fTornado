// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC7984} from "./ERC7984.sol";
import {FHE, externalEuint64, ebool, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {MerkleTreeWithHistory} from "./utils/MerkleTreeWithHistory.sol";
import {IERC20, IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

interface IVerifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[6] calldata _pubSignals
    ) external returns (bool);
}

contract fTornado is ZamaEthereumConfig, MerkleTreeWithHistory, ERC7984 {
    // structs
    struct PendingUnwrap {
        address user;
        bytes32 commitment;
        euint64 actualAmount;
    }

    // storage
    IVerifier public immutable verifier;
    IERC20 public token;
    uint256 public denomination;
    euint64 public wrappedDenomination;
    uint currentPendingIndex;

    mapping(uint => PendingUnwrap) public pendingUnwraps;
    mapping(bytes32 => bool) public nullifierHashes;
    mapping(bytes32 => bool) public commitments;

    // events
    event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 blockNumber);
    event Wrap(address user, bytes32 nullifierHash, uint256 blockNumber);
    event Withdraw(address user, bytes32 nullifierHash, uint256 blockNumber);
    event PendingUnwrapEvent(
        address user,
        bytes32 commitment,
        euint64 actualAmount,
        uint256 pendingUnwrapIndex,
        uint256 blockNumber
    );
    event UnwrapFinalized(
        address user,
        bytes32 commitment,
        euint64 actualAmount,
        uint256 pendingUnwrapIndex,
        uint256 blockNumber
    );
    event UnwrapFailed(
        address user,
        bytes32 commitment,
        euint64 actualAmount,
        uint256 pendingUnwrapIndex,
        uint256 blockNumber
    );

    /**
        @dev The constructor
        @param _verifier the address of SNARK verifier for this contract
        @param _denomination transfer amount for each deposit
        @param _encryptedDenomination the same denomination in encrypted form
        @param _denominationProof proof of knowing the unencrypted value
        @param _token the address of the token being wrapped
    **/
    constructor(
        IVerifier _verifier,
        uint256 _denomination,
        externalEuint64 _encryptedDenomination, // Encrypted input
        bytes memory _denominationProof,
        IERC20 _token
    )
        MerkleTreeWithHistory()
        ERC7984(
            string.concat("ft ", IERC20Metadata(address(_token)).name()),
            string.concat("ft", IERC20Metadata(address(_token)).symbol()),
            ""
        )
    {
        require(_denomination > 0, "denomination should be greater than 0");
        verifier = _verifier;
        token = _token;
        denomination = _denomination;
        wrappedDenomination = FHE.fromExternal(_encryptedDenomination, _denominationProof);

        // ACL: allow contract to wrok with encrypted denomination
        FHE.allowThis(wrappedDenomination);
    }

    // read fns
    /** 
        @dev whether a note is already spent 
        @param _nullifierHash hash being checked
        @return bool true if spent; false if unspent
    **/
    function isSpent(bytes32 _nullifierHash) public view returns (bool) {
        return nullifierHashes[_nullifierHash];
    }

    /** 
        @dev whether an array of notes is already spent 
        @param _nullifierHashes hashes being checked
        @return spent array of bools, true if spent; false if unspent
    **/
    function isSpentArray(bytes32[] calldata _nullifierHashes) external view returns (bool[] memory spent) {
        spent = new bool[](_nullifierHashes.length);
        for (uint256 i = 0; i < _nullifierHashes.length; i++) {
            if (isSpent(_nullifierHashes[i])) {
                spent[i] = true;
            }
        }
    }

    /** 
        @dev get the data of a pending unwrap
        @param _index index of the pending unwrap
        @return PendingUnwrap array of bools, true if spent; false if unspent
    **/
    function getPendingUnwrap(uint _index) external view returns (PendingUnwrap memory) {
        return pendingUnwraps[_index];
    }

    // Deposit
    /**
    @dev Deposit funds into the contract. The caller must approve value equal to or `denomination` of this instance.
    @param _commitment the note commitment, which is PedersenHash(nullifier + secret)
  */
    function deposit(bytes32 _commitment) external {
        uint32 insertedIndex = _insertToMerkle(_commitment);
        _processDeposit();

        emit Deposit(_commitment, insertedIndex, block.number);
    }

    // Wrap
    /**
        @dev Wrap a note to tfTokens
        @param _proof zk proof of the validity of note
        @param _root one of the roots of the tree with a secret commitment
        @param _recipient the address which is to receive the tfTokens
        @param _nullifierHash the nullifier hash corresponding to the note
        @param _relayer the relayer that sends the tx 
        @param _fee fee paid to relayer
        @param _refund refun to user
    **/
    function wrap(
        bytes calldata _proof,
        bytes32 _root,
        address _recipient,
        bytes32 _nullifierHash,
        address _relayer,
        uint256 _fee,
        uint256 _refund
    ) external {
        require(!nullifierHashes[_nullifierHash], "The note has been already spent");
        require(isKnownRoot(_root), "Cannot find your merkle root"); // Make sure to use a recent one

        // Decode the proof from bytes
        (uint256[2] memory pA, uint256[2][2] memory pB, uint256[2] memory pC) = abi.decode(
            _proof,
            (uint256[2], uint256[2][2], uint256[2])
        );

        // The circuit outputs: [root, receiver, nullifierHash, relayer, fee, refund]
        require(
            verifier.verifyProof(
                pA,
                pB,
                pC,
                [
                    uint256(_root),
                    uint256(uint160(_recipient)),
                    uint256(_nullifierHash),
                    uint256(uint160(_relayer)),
                    _fee,
                    _refund
                ]
            ),
            "Invalid wrap proof"
        );

        // Mark it as spent
        nullifierHashes[_nullifierHash] = true;
        // Mint tfTokens to the recipient
        _mint(_recipient, wrappedDenomination);
        emit Wrap(_recipient, _nullifierHash, block.number);
    }

    // Unwrap
    /**
        @dev 2 step process, must call finalizeUnwrap after calling this with decrypted amount
        @param _commitment a new note commitment
        @return pendingIndex the index with the data of unwrap request
    **/
    function unwrap(bytes32 _commitment) external returns (uint) {
        // attempt to transfer and log the actual trasnfer amount
        euint64 actualAmount = _processConfidentialDeposit();

        // store the unwrap request
        uint previousPendingIndex = currentPendingIndex;
        PendingUnwrap storage pendingUnwrap = pendingUnwraps[currentPendingIndex];
        pendingUnwrap.user = msg.sender;
        pendingUnwrap.commitment = _commitment;
        pendingUnwrap.actualAmount = actualAmount;

        currentPendingIndex++;

        // make the actual transfer amount publicly decyptable
        FHE.makePubliclyDecryptable(actualAmount);

        emit PendingUnwrapEvent(
            pendingUnwrap.user,
            pendingUnwrap.commitment,
            pendingUnwrap.actualAmount,
            previousPendingIndex,
            block.number
        );
        return previousPendingIndex;
    }

    // Unwrap
    /**
        @dev final step of the unwrap process
        @param _pendingUnwrapIndex the index with the data of unwrap request
        @param _abiEncodedClearAmount the decrypted value of the actual transfer amount
        @param _decryptionProof the proof the decryption
    **/
    function finalizeUnwrap(
        uint _pendingUnwrapIndex,
        bytes memory _abiEncodedClearAmount,
        bytes memory _decryptionProof
    ) external {
        // A valid request must exist
        PendingUnwrap storage pendingUnwrap = pendingUnwraps[_pendingUnwrapIndex];
        require(pendingUnwrap.user != address(0), "tF: Already processed");

        // Check the clear amount against the proof
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(pendingUnwrap.actualAmount);
        FHE.checkSignatures(cts, _abiEncodedClearAmount, _decryptionProof);

        // If the actualAmount is 0, then the transfer failed
        uint actualAmount = abi.decode(_abiEncodedClearAmount, (uint));
        if (actualAmount != 0) {
            // Add to merkle tree so that the token can be withdrawn later
            _insertToMerkle(pendingUnwrap.commitment);
            // Burn the denomination
            _burn(address(this), wrappedDenomination);
            emit UnwrapFinalized(
                pendingUnwrap.user,
                pendingUnwrap.commitment,
                pendingUnwrap.actualAmount,
                _pendingUnwrapIndex,
                block.number
            );
        } else {
            emit UnwrapFailed(
                pendingUnwrap.user,
                pendingUnwrap.commitment,
                pendingUnwrap.actualAmount,
                _pendingUnwrapIndex,
                block.number
            );
        }

        // clear storage
        delete pendingUnwraps[_pendingUnwrapIndex];
    }

    // Withdraw
    /**
        @dev Withdraw the underlying token
        @param _proof zk proof of the validity of note
        @param _root one of the roots of the tree with a secret commitment
        @param _recipient the address which is to receive the tfTokens
        @param _nullifierHash the nullifier hash corresponding to the note
        @param _relayer the relayer that sends the tx 
        @param _fee fee paid to relayer
        @param _refund refun to user
    **/
    function withdraw(
        bytes calldata _proof,
        bytes32 _root,
        address _recipient,
        bytes32 _nullifierHash,
        address _relayer,
        uint256 _fee,
        uint256 _refund
    ) external {
        require(!nullifierHashes[_nullifierHash], "The note has been already spent");
        require(isKnownRoot(_root), "Cannot find your merkle root"); // Make sure to use a recent one

        // Decode the proof from bytes
        (uint256[2] memory pA, uint256[2][2] memory pB, uint256[2] memory pC) = abi.decode(
            _proof,
            (uint256[2], uint256[2][2], uint256[2])
        );

        // The circuit outputs: [root, receiver, isWithdraw, nullifierHash]
        require(
            verifier.verifyProof(
                pA,
                pB,
                pC,
                [
                    uint256(_root),
                    uint256(uint160(_recipient)),
                    uint256(_nullifierHash),
                    uint256(uint160(_relayer)),
                    _fee,
                    _refund
                ]
            ),
            "Invalid withdraw proof"
        );

        // Mark it as spent
        nullifierHashes[_nullifierHash] = true;
        _processWithdraw(_recipient);
        emit Withdraw(_recipient, _nullifierHash, block.number);
    }

    // interna fns
    /** @dev calls transferFrom on the sender */
    function _processDeposit() internal {
        require(token.transferFrom(msg.sender, address(this), denomination), "fTornado: insuff bal/allowance");
    }

    /** @dev inserts the commitment to merkle tree **/
    function _insertToMerkle(bytes32 _commitment) internal returns (uint32) {
        require(!commitments[_commitment], "The commitment has been submitted");

        uint32 insertedIndex = _insert(_commitment);
        commitments[_commitment] = true;

        return insertedIndex;
    }

    /** @dev calls confidentialTransferFrom on the sender **/
    function _processConfidentialDeposit() internal returns (euint64) {
        FHE.allow(wrappedDenomination, msg.sender);
        euint64 actualAmount = confidentialTransferFrom(msg.sender, address(this), wrappedDenomination);
        return actualAmount;
    }

    /** @dev transfers tokens to the recipient **/
    function _processWithdraw(address _recipient) internal {
        require(token.transfer(_recipient, denomination), "fTornado: insuff bal");
    }
}
