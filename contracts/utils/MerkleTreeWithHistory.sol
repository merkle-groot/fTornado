// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {PoseidonT3} from "../poseidon/PoseidonT3.sol";

contract MerkleTreeWithHistory {
    uint256 public constant FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint32 public immutable levels;

    // the following variables are made public for easier testing and debugging and
    // are not supposed to be accessed in regular code

    // filledSubtrees and roots could be bytes32[size], but using mappings makes it cheaper because
    // it removes index range check on every interaction
    mapping(uint256 => bytes32) public filledSubtrees;
    mapping(uint256 => bytes32) public roots;
    uint32 public constant ROOT_HISTORY_SIZE = 30;
    uint32 public currentRootIndex = 0;
    uint32 public nextIndex = 0;

    constructor() {
        levels = 31;
        for (uint32 i = 0; i < levels; i++) {
            filledSubtrees[i] = zeros(i);
        }

        roots[0] = zeros(levels);
    }

    /**
    @dev Hash 2 tree leaves, returns MiMC(_left, _right)
  */
    function hashLeftRight(bytes32 _left, bytes32 _right) public pure returns (bytes32) {
        uint[2] memory items;
        items[0] = uint256(_left);
        items[1] = uint256(_right);

        return bytes32(PoseidonT3.hash(items));
    }

    function _insert(bytes32 _leaf) internal returns (uint32 index) {
        uint32 _nextIndex = nextIndex;
        // Check if tree is full (2^levels elements) using uint256 to avoid overflow
        require(uint256(_nextIndex) < uint256(2) ** levels, "Merkle tree is full. No more leaves can be added");
        uint32 currentIndex = _nextIndex;
        bytes32 currentLevelHash = _leaf;
        bytes32 left;
        bytes32 right;

        for (uint32 i = 0; i < levels; i++) {
            if (currentIndex % 2 == 0) {
                left = currentLevelHash;
                right = zeros(i);
                filledSubtrees[i] = currentLevelHash;
            } else {
                left = filledSubtrees[i];
                right = currentLevelHash;
            }
            currentLevelHash = hashLeftRight(left, right);
            currentIndex /= 2;
        }

        uint32 newRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        currentRootIndex = newRootIndex;
        roots[newRootIndex] = currentLevelHash;
        nextIndex = _nextIndex + 1;
        return _nextIndex;
    }

    /**
    @dev Whether the root is present in the root history
  */
    function isKnownRoot(bytes32 _root) public view returns (bool) {
        if (_root == 0) {
            return false;
        }
        uint32 _currentRootIndex = currentRootIndex;
        uint32 i = _currentRootIndex;
        do {
            if (_root == roots[i]) {
                return true;
            }
            if (i == 0) {
                i = ROOT_HISTORY_SIZE;
            }
            i--;
        } while (i != _currentRootIndex);
        return false;
    }

    /**
    @dev Returns the last root
  */
    function getLastRoot() public view returns (bytes32) {
        return roots[currentRootIndex];
    }

    /// @dev provides Zero (Empty) elements for a MiMC MerkleTree. Up to 32 levels
    function zeros(uint256 i) public pure returns (bytes32) {
        if (i == 0) return bytes32(0x2a09a9fd93c590c26b91effbb2499f07e8f7aa12e2b4940a3aed2411cb65e11c);
        else if (i == 1) return bytes32(0x17192e62a157556849d93b3c6be1e2bd1f3f1660d10dd9b1ffc429aa9021252c);
        else if (i == 2) return bytes32(0x04d5abb4c7f77e3b5d8bc7a049d5ba6e79f29c5c5a9edf0a58726e653e8bc0c7);
        else if (i == 3) return bytes32(0x0ea559a90beac7d48cc70dfad2fea27621b76f140446329b293a04454ccb0ec3);
        else if (i == 4) return bytes32(0x26f52f9b31ef80782798f2ae44659dc1bedf53ac38366d4dfed74ce7d95ad1d5);
        else if (i == 5) return bytes32(0x2fa27c5cf0185654d6dcf10df1b382324abdf62d73d395be1cc935ab470354f0);
        else if (i == 6) return bytes32(0x01c08b39621c262350bc2ddca369a968a68750dacb269e7aa9915245eb0ec3f1);
        else if (i == 7) return bytes32(0x2a39b3a355f8050db51818064cf8caa6f17148535edff5098625bc539fd4c038);
        else if (i == 8) return bytes32(0x02f8474b5fdf6cfcdb206e08ca30a69d659ff1aa274f1951b9a240a41504a897);
        else if (i == 9) return bytes32(0x255c8588a2609472e1547d5407c25f8f33917034302b4076d78cf07f60d69546);
        else if (i == 10) return bytes32(0x0b01ab3090cbdc900fab5c56945ae060c3c43471a6c421235e5c9fb7d9d08382);
        else if (i == 11) return bytes32(0x15950947deae80046b47ad936c2be2f9a594f90c28645a61bd418a5bd145978d);
        else if (i == 12) return bytes32(0x1df9f68ef245a86b3e8c13a0fbfcc4b59a1f264d88f9958bc976069b2def72ad);
        else if (i == 13) return bytes32(0x215e5f11c3f914dba3add7303a389aaa6a9894c9bf427c71dcdf082249805311);
        else if (i == 14) return bytes32(0x12df9d7eb43fe66c3d9169021a80939d04e9a3c3d514eef6a269a1a68857d8cd);
        else if (i == 15) return bytes32(0x2733ef21e2d290bdeadf2f631399f90c04217e950009f2a3fae9f445934792af);
        else if (i == 16) return bytes32(0x1b5de3d4aa8b60175a7985cc5a929ce294154ea35f854eb5cdf3f9e7f15661e2);
        else if (i == 17) return bytes32(0x22d0214ec42623df8d4d65e3c67a0a08fe9c51325fe55b3376f6575a5197af19);
        else if (i == 18) return bytes32(0x1c5f649dea85df276a312d1516d953b4909dad742b3b312ba460d0200a61d158);
        else if (i == 19) return bytes32(0x2b80173de43b197a0bdada09d8d49c79c110b1db98dd14ef96f9432fc74620ad);
        else if (i == 20) return bytes32(0x2d3c07bea6883428edd2d80d07cec4b911309fed96743822d6aadea06313a951);
        else if (i == 21) return bytes32(0x044b605acb7c3bca11cc992ed30df8dd163eaa4ce5ccb6673c55a2f5c37d8e33);
        else if (i == 22) return bytes32(0x0822dfe90c9a51978400674882da60595fe66e40e6e065decf65926c11dbdbc5);
        else if (i == 23) return bytes32(0x265eff4400e9bfdae062c4391ae64ccc0d218f9c81c98615691a31b5cfee38d7);
        else if (i == 24) return bytes32(0x1146ced274f251bb955a515033ce7039c1935f9ad4d320f577fd1a63d003b35f);
        else if (i == 25) return bytes32(0x2d531efb2344c3a3041c901451322dd82e465efc2c2a9cec7b60e35b49713746);
        else if (i == 26) return bytes32(0x1c9dc4d75d7ccb25de67387968db68e58110d7b11915bd8f2ce863ef7acee1da);
        else if (i == 27) return bytes32(0x14ebf8fce45888ef14e6bafa70f46357325cbb29c30ddb67869f2cb914a7a392);
        else if (i == 28) return bytes32(0x248d0bf188574649b104753c86f238bd046e87a13ae22a0df56099534f22ba02);
        else if (i == 29) return bytes32(0x0f36d16643f39c14978705b01fe4c37ec28efc1e43fd6f5234f89d60c493b40f);
        else if (i == 30) return bytes32(0x190243185a55d51d400818327087183ce71831506dde09050d868927f4c9ed00);
        else if (i == 31) return bytes32(0x0d7bb3ac70926cca19d0f86ce2bc7b3454da6aa534d72ab4c0b7c39ee9cf42dd);
        else if (i == 32) return bytes32(0x19ec506fc767aa88d3397c7007611351a4aef78e1f2fc938460ccbd26a03f4f2);
        else revert("Index out of bounds");
    }
}
