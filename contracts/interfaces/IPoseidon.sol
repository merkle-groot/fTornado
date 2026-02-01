// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IPoseidon
 * @notice Interface for Poseidon hash contract
 */
interface IPoseidon {
    /**
     * @notice Compute Poseidon hash of 2 inputs
     * @param inputs Array of 2 uint256 values to hash
     * @return The Poseidon hash as a uint256
     */
    function poseidon(uint256[2] calldata inputs) external pure returns (uint256);

    /**
     * @notice Compute Poseidon hash of 2 bytes32 inputs
     * @param input Array of 2 bytes32 values to hash
     * @return The Poseidon hash as a bytes32
     */
    function poseidon(bytes32[2] calldata input) external pure returns (bytes32);
}
