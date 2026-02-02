#!/bin/bash
set -e

# Set the directory to the location of the script
cd "$(dirname "$0")"

# Configuration
OUTPUT_DIR="../circuit_artifacts"
CIRCUIT="../src/wrapOrWithdraw.circom"
CIRCUIT_NAME="wrapOrWithdraw"
COMPILED_DIR="$OUTPUT_DIR"
PTAU_DIR="$COMPILED_DIR/ptau"
CONTRACTS_DIR="../../contracts"
PTAU_PRE="../src/ptau/powersOfTau28_hez_final_15.ptau"

# Check if required tools are installed
if ! command -v circom &> /dev/null || ! command -v snarkjs &> /dev/null; then
    echo "Error: circom and snarkjs are required" >&2
    exit 1
fi

# Validate required files exist
if [[ ! -f "$CIRCUIT" ]]; then
    echo "Error: Circuit file not found: $CIRCUIT" >&2
    exit 1
fi

if [[ ! -f "$PTAU_PRE" ]]; then
    echo "Error: PTAU file not found: $PTAU_PRE" >&2
    exit 1
fi

mkdir -p "$COMPILED_DIR"
mkdir -p "$PTAU_DIR"

echo "Compiling circuit..."
circom "$CIRCUIT" --r1cs --wasm --output "$COMPILED_DIR"

echo "Performing trusted setup..."
snarkjs groth16 setup \
    "$COMPILED_DIR/$CIRCUIT_NAME.r1cs" \
    "$PTAU_PRE" \
    "$PTAU_DIR/${CIRCUIT_NAME}_0000.zkey"

snarkjs zkey contribute \
    "$PTAU_DIR/${CIRCUIT_NAME}_0000.zkey" \
    "$PTAU_DIR/${CIRCUIT_NAME}_0001.zkey" \
    --name="merkle-groot" \
    -v \
    -e="random numbers 48931 938 1251 06105"

snarkjs zkey beacon \
    "$PTAU_DIR/${CIRCUIT_NAME}_0001.zkey" \
    "$PTAU_DIR/${CIRCUIT_NAME}_final.zkey" \
    0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f \
    10 \
    -n="Final Beacon phase2"

snarkjs zkey export verificationkey \
    "$PTAU_DIR/${CIRCUIT_NAME}_final.zkey" \
    "$COMPILED_DIR/verification_key.json"

echo "Generating Solidity verifier..."
snarkjs zkey export solidityverifier "$PTAU_DIR/${CIRCUIT_NAME}_final.zkey" "../../contracts/verifier.sol"

echo "Setup completed successfully!"

