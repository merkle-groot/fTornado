#!/bin/bash
set -e

# Configuration
OUTPUT_DIR="./circuit_artifacts"
CIRCUIT_NAME="Withdraw"
COMPILED_DIR="$OUTPUT_DIR"
PTAU_DIR="$COMPILED_DIR/ptau"
PROOF_DIR="$OUTPUT_DIR/proofs"
WITNESS_GEN_DIR="$COMPILED_DIR/withdraw_js"

# Check if required tools are installed
if ! command -v snarkjs &> /dev/null || ! command -v node &> /dev/null; then
    echo "Error: snarkjs and node are required" >&2
    exit 1
fi

# Validate input
INPUT_FILE_NUM=$1
if [[ ! "$INPUT_FILE_NUM" =~ ^[0-9]+$ ]]; then
    echo "Error: Input file number must be a positive integer" >&2
    exit 1
fi

INPUT_FILE="$COMPILED_DIR/input$INPUT_FILE_NUM.json"
if [[ ! -f "$INPUT_FILE" ]]; then
    echo "Error: Input file not found: $INPUT_FILE" >&2
    exit 1
fi

mkdir -p "$PROOF_DIR"

echo "Generating witness..."
node "$WITNESS_GEN_DIR/generate_witness.js" \
    "$WITNESS_GEN_DIR/withdraw.wasm" \
    "$INPUT_FILE" \
    "$PROOF_DIR/witness$INPUT_FILE_NUM.wtns"

echo "Generating proof..."
snarkjs groth16 prove \
    "$PTAU_DIR/${CIRCUIT_NAME}_final.zkey" \
    "$PROOF_DIR/witness$INPUT_FILE_NUM.wtns" \
    "$PROOF_DIR/proof$INPUT_FILE_NUM.json" \
    "$PROOF_DIR/public$INPUT_FILE_NUM.json"

echo "Verifying proof..."
snarkjs groth16 verify \
    "$COMPILED_DIR/verification_key.json" \
    "$PROOF_DIR/public$INPUT_FILE_NUM.json" \
    "$PROOF_DIR/proof$INPUT_FILE_NUM.json"

echo "Proof checked!"
