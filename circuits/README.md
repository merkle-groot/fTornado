# ZstarkWarp Circuits

Zero-knowledge circuits for privacy-preserving withdrawals using Circom and Groth16 proofs.

## Overview

This directory contains Circom circuits that enable private withdrawals from the ZstarkWarp protocol. The circuits verify:
- Merkle tree membership proofs
- Validity of commitments (nullifier + secret key)
- Proof ownership and authorization

## Project Structure

```
circuits/
├── src/                          # Circuit source code
│   ├── withdraw.circom           # Main withdrawal circuit
│   ├── merkle_proof_checker.circom # Merkle proof verification
│   └── ptau/                     # Powers of Tau ceremony artifacts
│       └── powersOfTau28_hez_final_14.ptau
├── scripts/                      # Build and utility scripts
│   ├── bash_scripts/
│   │   ├── setup.sh              # Circuit compilation and trusted setup
│   │   └── proof_gen.sh          # Generate proofs for inputs
│   ├── operations/
│   │   ├── commitments.js        # Commitment management
│   │   ├── get_calldata.js       # Generate contract calldata
│   │   ├── proofs.js             # Proof generation utilities
│   │   └── setup.js              # Setup utilities
│   ├── lib/                      # Library utilities
│   ├── gen_inputs.js             # Generate test inputs
│   └── index.js                  # Entry point
├── tests/                        # Circuit tests
│   ├── test_withdraw.js          # Main withdrawal circuit tests
│   └── helpers/
│       ├── merkleTree.js         # Merkle tree helper
│       └── deposit.js            # Deposit helper
├── circuit_artifacts/             # Generated circuit files
│   ├── withdraw.r1cs             # Rank-1 Constraint System
│   ├── withdraw_js/              # WASM witness generator
│   ├── verification_key.json     # Verification key
│   ├── input*.json               # Input files for proofs
│   ├── proofs/                   # Generated proofs
│   │   ├── proof*.json           # ZK proofs
│   │   └── public*.json          # Public inputs
│   └── ptau/                     # Proving keys
│       └── Withdraw_final.zkey   # Final proving key
├── package.json                  # Node.js dependencies
└── .secrets                      # Secret configuration
```

## Circuit Architecture

### Main Circuit: Withdraw

The [`withdraw.circom`](src/withdraw.circom) circuit is the core ZK circuit that verifies withdrawals.

#### Public Inputs
- `root` - Merkle tree root
- `receiver` - Withdrawal recipient address
- `nullifierHash` - Hash of nullifier (prevents double-spending)

#### Private Inputs
- `secretKey` - User's secret key
- `nullifier` - Unique identifier for the deposit
- `commitment` - Leaf commitment in Merkle tree
- `siblings[32]` - Merkle path sibling nodes
- `isLeft[32]` - Direction indicators for path

#### Circuit Components

1. **CommitmentChecker** - Verifies commitment validity
   ```circom
   commitment = Poseidon(secretKey, nullifier)
   nullifierHash = Poseidon(nullifier)
   ```

2. **MerkleVerifier** - Verifies Merkle membership proof
   - Uses 32-level Merkle tree
   - Validates path from commitment to root
   - Uses Poseidon hash for all hash operations

### Merkle Proof Checker

The [`merkle_proof_checker.circom`](src/merkle_proof_checker.circom) circuit verifies Merkle tree inclusion proofs.

#### How It Works
1. Starts with leaf commitment
2. For each tree level:
   - Uses `Switcher` to order current hash and sibling
   - Hashes combined values with Poseidon
   - Propagates result up the tree
3. Final hash must equal public root

## Prerequisites

### Required Tools

- **Node.js** v16+ - JavaScript runtime
- **circom** v2.0.4+ - Circuit compiler
- **snarkjs** - ZK proof generation and verification
- **pnpm** - Package manager (optional, can use npm)

### Installation

```bash
# Install Node.js dependencies
npm install
# or
pnpm install

# Install circom globally (if not already installed)
npm install -g circom
npm install -g snarkjs

# Verify installation
circom --version
snarkjs --version
```

## Building Circuits

### 1. Circuit Compilation & Trusted Setup

Run the complete setup process:

```bash
bash scripts/bash_scripts/setup.sh
```

This script:
1. **Compiles** the Circom circuit to R1CS and WASM
   - Generates `withdraw.r1cs` (Rank-1 Constraint System)
   - Generates `withdraw_js/` with WASM witness generator

2. **Performs trusted setup** using Powers of Tau
   - Phase 2: Circuit-specific setup
   - Contribution phase with random entropy
   - Beacon phase to finalize
   - Exports verification key

3. **Generates Solidity verifier** using garaga
   - Creates verifier contract in `../contracts/src/verifier/`
   - Ready for deployment to Starknet

### Manual Build Steps

If you want to run steps manually:

```bash
# Compile circuit
circom src/withdraw.circom --r1cs --wasm --output circuit_artifacts

# Trusted setup (requires PTAU file)
snarkjs groth16 setup \
  circuit_artifacts/withdraw.r1cs \
  src/ptau/powersOfTau28_hez_final_14.ptau \
  circuit_artifacts/ptau/Withdraw_0000.zkey

# Contribute to ceremony
snarkjs zkey contribute \
  circuit_artifacts/ptau/Withdraw_0000.zkey \
  circuit_artifacts/ptau/Withdraw_0001.zkey \
  --name="1st Contributor" \
  -v \
  -e="some random entropy"

# Apply beacon
snarkjs zkey beacon \
  circuit_artifacts/ptau/Withdraw_0001.zkey \
  circuit_artifacts/ptau/Withdraw_final.zkey \
  0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f \
  10 \
  -n="Final Beacon phase2"

# Export verification key
snarkjs zkey export verificationkey \
  circuit_artifacts/ptau/Withdraw_final.zkey \
  circuit_artifacts/verification_key.json
```

### Generate Verifier Contract

```bash
cd ../contracts
echo "verifier" | garaga gen --system groth16 --vk "../circuits/circuit_artifacts/verification_key.json"
```

## Testing

### Run Circuit Tests

```bash
npm test
# or
npx mocha ./tests
```

### Test Coverage

Tests in [`tests/test_withdraw.js`](tests/test_withdraw.js) verify:

1. **Valid withdrawals** - All 64 leaves can withdraw successfully
2. **Invalid secret key** - Rejects wrong secret for commitment
3. **Invalid nullifier** - Rejects wrong nullifier
4. **Mismatched commitment** - Rejects commitment from different leaf
5. **Invalid root** - Rejects wrong Merkle root
6. **Corrupted path** - Rejects invalid Merkle path

## Generating Proofs

### 1. Prepare Input File

Create an input JSON file in `circuit_artifacts/`:

```json
{
  "root": "123456...",
  "receiver": "1729",
  "siblings": ["111...", "222...", ...],
  "isLeft": [1, 0, 1, ...],
  "nullifier": "123456",
  "nullifierHash": "789012...",
  "secretKey": "1337",
  "commitment": "456789..."
}
```

### 2. Generate Proof

```bash
bash scripts/bash_scripts/proof_gen.sh 1
#                                      ^^ Input file number
```

This script:
1. Generates witness from input using WASM
2. Creates Groth16 proof
3. Verifies the proof locally
4. Saves proof to `circuit_artifacts/proofs/`

### Manual Proof Generation

```bash
# Generate witness
node circuit_artifacts/withdraw_js/generate_witness.js \
  circuit_artifacts/withdraw_js/withdraw.wasm \
  circuit_artifacts/input1.json \
  circuit_artifacts/proofs/witness1.wtns

# Generate proof
snarkjs groth16 prove \
  circuit_artifacts/ptau/Withdraw_final.zkey \
  circuit_artifacts/proofs/witness1.wtns \
  circuit_artifacts/proofs/proof1.json \
  circuit_artifacts/proofs/public1.json

# Verify proof
snarkjs groth16 verify \
  circuit_artifacts/verification_key.json \
  circuit_artifacts/proofs/public1.json \
  circuit_artifacts/proofs/proof1.json
```

## Generating Contract Calldata

To convert proofs for smart contract calls:

```bash
node scripts/operations/get_calldata.js
```

This generates formatted calldata for Starknet contracts.

## Scripts

### Setup Scripts

- **[`scripts/bash_scripts/setup.sh`](scripts/bash_scripts/setup.sh)** - Full circuit compilation and trusted setup
- **[`scripts/bash_scripts/proof_gen.sh`](scripts/bash_scripts/proof_gen.sh)** - Generate proofs from inputs

### Utility Scripts

- **[`scripts/gen_inputs.js`](scripts/gen_inputs.js)** - Generate test input files
- **[`scripts/operations/get_calldata.js`](scripts/operations/get_calldata.js)** - Convert proofs to calldata
- **[`scripts/operations/commitments.js`](scripts/operations/commitments.js)** - Manage commitment data
- **[`scripts/operations/proofs.js`](scripts/operations/proofs.js)** - Proof utilities

## Dependencies

Key dependencies from [`package.json`](package.json):

- **circom_tester** v0.0.24 - Circuit testing framework
- **circomlib** v2.0.5 - Circom library (Poseidon hash, etc.)
- **circomlibjs** v0.1.7 - JavaScript bindings for circomlib
- **snarkjs** v0.7.5 - ZK proof generation and verification
- **mocha** v11.7.5 - Test framework
- **chai** v6.2.1 - Assertion library
- **garaga** v0.18.2 - Cairo verifier generation

## Circuit Artifacts

### R1CS File
- **File**: `circuit_artifacts/withdraw.r1cs`
- **Description**: Rank-1 Constraint System representation
- **Size**: ~3.8MB
- **Use**: Circuit compilation and setup

### WASM Files
- **Directory**: `circuit_artifacts/withdraw_js/`
- **Description**: Witness generator for web/browser use
- **Key file**: `generate_witness.js` - Generates witness from inputs

### Proving Key
- **File**: `circuit_artifacts/ptau/Withdraw_final.zkey`
- **Description**: Final proving key from trusted setup
- **Use**: Generate ZK proofs

### Verification Key
- **File**: `circuit_artifacts/verification_key.json`
- **Description**: Verification key for proof verification
- **Use**: Verify proofs on-chain and off-chain

### Proofs
- **Directory**: `circuit_artifacts/proofs/`
- **Files**:
  - `proof*.json` - Zero-knowledge proofs
  - `public*.json` - Public inputs for verification
  - `witness*.wtns` - Witness files (intermediate)

## Security Considerations

### Trusted Setup

The circuit uses a Powers of Tau ceremony:
- **Powers of Tau**: `powersOfTau28_hez_final_14.ptau` (pre-computed)
- **Circuit-specific phase**: Run during setup
- **Entropy**: Random entropy provided during contribution
- **Toxic waste**: Properly discarded in beacon phase

⚠️ **Important**: For production, use a multi-party ceremony with many contributors to ensure no single party knows the toxic waste.

### Nullifiers

The nullifier system prevents double-spending:
- Each deposit has unique nullifier
- Nullifier hash is public but reversible only with secret
- Contract tracks used nullifiers
- Once used, cannot be reused

### Commitment Privacy

- Commitments hide the link between deposits and withdrawals
- Only someone knowing secret + nullifier can prove ownership
- Merkle tree provides anonymity set

## Performance

### Circuit Stats

- **Tree depth**: 32 levels
- **Max leaves**: 2^32 (~4.3 billion)
- **Constraints**: ~50,000 R1CS constraints
- **Witness generation**: ~100ms (browser)
- **Proof generation**: ~5-10s (depending on hardware)
- **Proof verification**: ~10ms (contract)

### Optimization Tips

1. **Use WASM witness generator** for fast witness computation
2. **Pre-compute Merkle roots** for batch withdrawals
3. **Cache proving key** in memory for multiple proofs
4. **Use parallel proof generation** for batch operations

## Integration with Contracts

### Contract Deployment

1. Build circuit and run trusted setup
2. Generate verifier contract with garaga
3. Deploy verifier contract to Starknet
4. Deploy main ZstarkWarp contract with verifier address

### Withdrawal Flow

1. User deposits and receives commitment
2. Contract adds commitment to Merkle tree
3. User generates proof offline:
   - Create input JSON with private data
   - Generate witness
   - Create Groth16 proof
4. User calls `withdraw()` with proof + public inputs
5. Contract verifies proof on-chain
6. If valid, releases funds to recipient

## Troubleshooting

### Build Issues

**Error: `circom: command not found`**
```bash
npm install -g circom
```

**Error: Missing PTAU file**
```bash
# Download from Perpetual Powers of Tau ceremony
curl -o src/ptau/powersOfTau28_hez_final_14.ptau \
  https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_14.ptau
```

### Proof Generation Issues

**Error: Witness generation fails**
- Check all inputs are valid field elements (< 21888242871839275222246405745257275088548364400416034343698204186575808495617)
- Verify input JSON format matches circuit expectations

**Error: Proof verification fails**
- Ensure verification key matches proving key
- Check public inputs are correct
- Verify witness was generated from correct circuit

### Test Failures

```bash
# Run tests with verbose output
npx mocha ./tests --reporter spec

# Run specific test
npx mocha ./tests/test_withdraw.js --grep "Should fail for invalid proofs"
```

## Additional Resources

- [Circom Documentation](https://docs.circom.io/)
- [snarkjs Documentation](https://github.com/iden3/snarkjs)
- [circomlib](https://github.com/iden3/circomlib)
- [Powers of Tau Ceremony](https://github.com/iden3/powersOfTau)
- [Tornado Cash Circuits](https://github.com/tornadocash/tornado-core) - Similar circuit design
- [ZK Whitepaper](https://electriccoin.co/blog/zkash-anonymous-payments-on-ethereum/) - Background on ZK privacy

## License

ISC
