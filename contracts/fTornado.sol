// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {MerkleTreeWithHistory} from "./utils/MerkleTreeWithHistory.sol";
import {IERC20, IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "./ERC7984.sol";
import {FHE, externalEuint64, ebool, euint64} from "@fhevm/solidity/lib/FHE.sol";

interface IVerifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[6] calldata _pubSignals
    ) external returns (bool);
}

contract fTornado is ZamaEthereumConfig, MerkleTreeWithHistory, ERC7984 {
    IVerifier public immutable verifier;
    IERC20 token;
    uint256 public denomination;
    euint64 public wrappedDenomination;

    mapping(bytes32 => bool) public nullifierHashes;
    // we store all commitments just to prevent accidental deposits with the same commitment
    mapping(bytes32 => bool) public commitments;

    event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp);
    event Wrap(address to, bytes32 nullifierHash);

    /**
    @dev The constructor
    @param _verifier the address of SNARK verifier for this contract
    @param _denomination transfer amount for each deposit
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
            string.concat("fTornado ", IERC20Metadata(address(_token)).name()),
            string.concat("fTornado", IERC20Metadata(address(_token)).symbol()),
            ""
        )
    {
        require(_denomination > 0, "denomination should be greater than 0");
        verifier = _verifier;
        token = _token;
        denomination = _denomination;
        wrappedDenomination = FHE.fromExternal(_encryptedDenomination, _denominationProof);

        FHE.allowThis(wrappedDenomination);
    }

    /**
    @dev Deposit funds into the contract. The caller must send (for ETH) or approve (for ERC20) value equal to or `denomination` of this instance.
    @param _commitment the note commitment, which is PedersenHash(nullifier + secret)
  */
    function deposit(bytes32 _commitment, address _user) external {
        uint32 insertedIndex = _insertToMerkle(_commitment);
        _processDeposit(_user);

        emit Deposit(_commitment, insertedIndex, block.timestamp);
    }

    function unwrap(bytes32 _commitment, address _user) external {
        uint32 insertedIndex = _insertToMerkle(_commitment);
        _processConfidentialDeposit(_user);
    }

    function _insertToMerkle(bytes32 _commitment) internal returns (uint32) {
        require(!commitments[_commitment], "The commitment has been submitted");

        uint32 insertedIndex = _insert(_commitment);
        commitments[_commitment] = true;

        return insertedIndex;
    }

    function _processConfidentialDeposit(address _user) internal {
        euint64 zero = FHE.asEuint64(0);
        euint64 actualAmount = confidentialTransferFrom(_user, address(this), wrappedDenomination);

        ebool transferredSomething = FHE.gt(actualAmount, zero);
        // FHE.req(transferredSomething); // Revert if nothing transferred

        ebool isCorrectAmount = FHE.eq(actualAmount, wrappedDenomination);
        // FHE.req(isCorrectAmount); // Revert if wrong amount
    }

    /** @dev this function is defined in a child contract */
    function _processDeposit(address _user) internal {
        require(token.transferFrom(msg.sender, address(this), denomination), "fTornado: insuff bal/allowance");
    }

    /**
    @dev Withdraw a deposit from the contract. `proof` is a zkSNARK proof data, and input is an array of circuit public inputs
    `input` array consists of:
      - merkle root of all deposits in the contract
      - hash of unique deposit nullifier to prevent double spends
      - the recipient of funds
      - optional fee that goes to the transaction sender (usually a relay)
  */
    function wrap(
        bytes calldata _proof,
        bytes32 _root,
        address _recipient,
        bytes32 _nullifierHash,
        address relayer,
        uint256 fee,
        uint256 refund
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
                    uint256(uint160(relayer)),
                    fee,
                    refund
                ]
            ),
            "Invalid wrap proof"
        );

        nullifierHashes[_nullifierHash] = true;
        _mint(_recipient, wrappedDenomination);
        emit Wrap(_recipient, _nullifierHash);
    }

    function withdraw(
        bytes calldata _proof,
        bytes32 _root,
        address _recipient,
        bytes32 _nullifierHash,
        address relayer,
        uint256 fee,
        uint256 refund
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
                    uint256(uint160(relayer)),
                    fee,
                    refund
                ]
            ),
            "Invalid withdraw proof"
        );

        nullifierHashes[_nullifierHash] = true;
        _processWithdraw(_recipient);
        emit Wrap(_recipient, _nullifierHash);
    }

    /** @dev this function is defined in a child contract */
    function _processWithdraw(address _recipient) internal {
        require(token.transfer(_recipient, denomination), "fTornado: insuff bal");
    }

    /** @dev whether a note is already spent */
    function isSpent(bytes32 _nullifierHash) public view returns (bool) {
        return nullifierHashes[_nullifierHash];
    }

    /** @dev whether an array of notes is already spent */
    function isSpentArray(bytes32[] calldata _nullifierHashes) external view returns (bool[] memory spent) {
        spent = new bool[](_nullifierHashes.length);
        for (uint256 i = 0; i < _nullifierHashes.length; i++) {
            if (isSpent(_nullifierHashes[i])) {
                spent[i] = true;
            }
        }
    }
}
