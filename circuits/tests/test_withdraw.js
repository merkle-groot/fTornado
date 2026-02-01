const chai = require("chai");
const path = require("path");
const wasm_tester = require("circom_tester").wasm;
const { MerkleTree } = require("./helpers/merkleTree.js");
const { getCommitment } = require("./helpers/deposit.js");
const assert = chai.assert;

// Cache the circuit to avoid recompiling
let circuit = null;
let merkleTree = null;

// Before all tests, compile the circuit once
before(async function() {
    this.timeout(100000);
    circuit = await wasm_tester(path.join(__dirname, "../src/wrapOrWithdraw.circom"), {
        verbose: true,
        logs: true
    });
    merkleTree = new MerkleTree(31);
    await merkleTree.init();
});

describe("Withdraw circuit test", function () {
    this.timeout(100000);
    let workingParams = [];
    const numLeaves = 64;

    before(async function() {
        console.log(`Creating ${numLeaves} commitments...`);

        // Create all commitments first
        const commitments = [];
        for (let i = 0; i < numLeaves; i++) {
            const secretKey = BigInt(1337 + i);
            const nullifier = BigInt(123456 + i);
            const receiver = BigInt(1729 + i);
            const relayer = BigInt(42 + i);
            const fee = BigInt(128 + i);
            const refund = BigInt(256 + i);

            try {
                const { commitment, nullifierHash } = await getCommitment(secretKey, nullifier);

                if (!commitment) {
                    console.error(`Commitment ${i} is undefined after getCommitment`);
                    throw new Error(`Commitment ${i} is undefined`);
                }

                commitments.push({
                    secretKey,
                    nullifier,
                    receiver,
                    commitment,
                    nullifierHash,
                    relayer,
                    fee, 
                    refund
                });
            } catch (error) {
                console.error(`Error creating commitment ${i}:`, error);
                throw error;
            }
        }

        console.log(`Inserting ${numLeaves} commitments into Merkle tree one by one...`);

        // Insert all commitments individually to avoid bulkInsert issues
        for (let i = 0; i < commitments.length; i++) {
            await merkleTree.insert(commitments[i].commitment);
        }

        console.log(`Generating Merkle paths for all ${numLeaves} leaves...`);

        // Get paths for all leaves
        for (let i = 0; i < numLeaves; i++) {
            const {isLeft, siblings} = merkleTree.getPath(i);
            const root = merkleTree.getRoot();

            workingParams.push({
                root,
                receiver: commitments[i].receiver,
                siblings,
                isLeft,
                nullifier: commitments[i].nullifier,
                nullifierHash: commitments[i].nullifierHash,
                secretKey: commitments[i].secretKey,
                commitment: commitments[i].commitment,
                relayer: commitments[i].relayer,
                fee: commitments[i].fee,
                refund: commitments[i].refund
            });
        }

        console.log(`Setup complete for ${numLeaves} leaves`);
    });

    it("Should allow withdrawal for all 64 leaves", async function () {
        console.log(`Testing withdrawal for all ${numLeaves} leaves sequentially...`);
        // Test each leaf efficiently in a loop
        for (let i = 0; i < numLeaves; i++) {
            if (i % 10 === 0) {
                console.log(`Testing leaf ${i}/${numLeaves}`);
            }
            const w = await circuit.calculateWitness(workingParams[i]);
            // should not fail
            await circuit.checkConstraints(w);
        }
        console.log(`Successfully tested all ${numLeaves} leaves`);
    });

    it("Should fail for invalid proofs", async function () {
        console.log("Testing invalid proof scenarios...");

        // Test case 1: Invalid secret key (wrong secret for given commitment)
        console.log("Testing invalid secret key...");
        const invalidSecretParams = {
            ...workingParams[0],
            secretKey: BigInt(999999999), // Wrong secret key
        };

        try {
            const w = await circuit.calculateWitness(invalidSecretParams);
            await circuit.checkConstraints(w);
            assert.fail("Should have failed with invalid secret key");
        } catch (error) {
            console.log("Correctly failed with invalid secret key");
            assert.include(error.message, "Assert Failed", "Should be a constraint failure");
        }

        // Test case 2: Invalid nullifier
        console.log("Testing invalid nullifier...");
        const invalidNullifierParams = {
            ...workingParams[0],
            nullifier: BigInt(888888888), // Wrong nullifier
        };

        try {
            const w = await circuit.calculateWitness(invalidNullifierParams);
            await circuit.checkConstraints(w);
            assert.fail("Should have failed with invalid nullifier");
        } catch (error) {
            console.log("Correctly failed with invalid nullifier");
            assert.include(error.message, "Assert Failed", "Should be a constraint failure");
        }

        // Test case 3: Wrong commitment (doesn't match secret+nullifier)
        console.log("Testing mismatched commitment...");
        const invalidCommitmentParams = {
            ...workingParams[0],
            commitment: workingParams[1].commitment, // Use commitment from another leaf
        };

        try {
            const w = await circuit.calculateWitness(invalidCommitmentParams);
            await circuit.checkConstraints(w);
            assert.fail("Should have failed with mismatched commitment");
        } catch (error) {
            console.log("Correctly failed with mismatched commitment");
            assert.include(error.message, "Assert Failed", "Should be a constraint failure");
        }

        // Test case 4: Invalid merkle root (completely wrong root)
        console.log("Testing invalid merkle root...");
        const invalidRootParams = {
            ...workingParams[0],
            root: BigInt(0), // Use zero as an obviously invalid root
        };

        try {
            const w = await circuit.calculateWitness(invalidRootParams);
            await circuit.checkConstraints(w);
            assert.fail("Should have failed with invalid root");
        } catch (error) {
            console.log("Correctly failed with invalid merkle root");
            assert.include(error.message, "Assert Failed", "Should be a constraint failure");
        }

        // Test case 5: Corrupted sibling path
        console.log("Testing corrupted sibling path...");
        const corruptedSiblings = [...workingParams[0].siblings];
        corruptedSiblings[0] = BigInt(123456789); // Corrupt the first sibling

        const invalidPathParams = {
            ...workingParams[0],
            siblings: corruptedSiblings,
        };

        try {
            const w = await circuit.calculateWitness(invalidPathParams);
            await circuit.checkConstraints(w);
            assert.fail("Should have failed with corrupted path");
        } catch (error) {
            console.log("Correctly failed with corrupted sibling path");
            assert.include(error.message, "Assert Failed", "Should be a constraint failure");
        }

        console.log("All invalid proof tests passed - circuit correctly rejects invalid inputs");
    });
});