# ZstarkWarp Circuits

Zero-knowledge circuits for privacy-preserving withdrawals using Circom and Groth16 proofs.

## Overview

Circom circuits enabling private withdrawals from the ZstarkWarp protocol. Verifies Merkle tree membership, commitment validity, and proof authorization.

## Project Structure

```
circuits/
├── src/withdraw.circom           # Main withdrawal circuit
├── src/merkle_proof_checker.circom # Merkle proof verification
├── scripts/                       # Build and utility scripts
├── tests/                         # Circuit tests
├── circuit_artifacts/              # Generated circuit files (R1CS, WASM, keys)
└── src/ptau/powersOfTau28_hez_final_14.ptau
```

## Circuit Architecture

### Withdraw Circuit

**Public Inputs**: `root`, `receiver`, `nullifierHash`

**Private Inputs**: `secretKey`, `nullifier`, `commitment`, `siblings[31]`, `isLeft[31]`

**Components**:
- **CommitmentChecker**: Verifies `Poseidon(secretKey, nullifier) = commitment`
- **MerkleVerifier**: Validates 31-level Merkle inclusion proof using Poseidon hash