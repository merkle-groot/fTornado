const { MerkleTree } = require("../../tests/helpers/merkleTree.js");
const { getCommitment } = require("../../tests/helpers/deposit.js");
const { CONFIG } = require("../lib/config.js");
const { getRandomBigInt } = require("../lib/utils.js");
const { writeFileSync } = require("fs");
const path = require("path");

const createCommitmentData = async (i) => {
    const [skMin, skMax] = CONFIG.valueRanges.secretKey;
    const [nMin, nMax] = CONFIG.valueRanges.nullifier;
    const [rMin, rMax] = CONFIG.valueRanges.receiver;

    const secretKey = getRandomBigInt(skMin, skMax);
    const nullifier = getRandomBigInt(nMin, nMax);
    const receiver = getRandomBigInt(rMin, rMax);

    const { commitment, nullifierHash } = await getCommitment(secretKey, nullifier);

    return { index: i, receiver, secretKey, nullifier, commitment, nullifierHash };
};

const generateCommitments = async () => {
    console.log("Setting up verifier with random commitments...");

    const merkleTree = new MerkleTree(CONFIG.merkleLevels);
    await merkleTree.init();

    console.log(`Creating ${CONFIG.numCommitments} random commitments...`);

    const commitments = await Promise.all(
        Array.from({ length: CONFIG.numCommitments }, (_, i) => createCommitmentData(i))
    );

    console.log(`Inserting commitments into Merkle tree...`);
    await Promise.all(commitments.map(c => merkleTree.insert(c.commitment)));

    console.log("Generating Merkle proofs for all commitments...");

    const allProofs = commitments.map((commitment, i) => {
        const { isLeft, siblings } = merkleTree.getPath(i);
        const root = merkleTree.getRoot();

        return { ...commitment, root, siblings, isLeft };
    });

    console.log(`Selecting ${CONFIG.numProofs} random commitments for verifier setup...`);

    const selectedIndices = new Set();
    while (selectedIndices.size < CONFIG.numProofs) {
        selectedIndices.add(Math.floor(Math.random() * CONFIG.numCommitments));
    }

    const selectedProofs = Array.from(selectedIndices).map(index => allProofs[index]);
    console.log(`Selected indices: ${[...selectedIndices].join(', ')}`);

    console.log("\nCreating individual input files...");

    selectedProofs.forEach((proof, i) => {
        const inputData = {
            root: proof.root.toString(),
            receiver: proof.receiver.toString(),
            siblings: proof.siblings.map(s => s.toString()),
            isLeft: proof.isLeft.map(val => Number(val)),
            nullifier: proof.nullifier.toString(),
            nullifierHash: proof.nullifierHash.toString(),
            secretKey: proof.secretKey.toString(),
            commitment: proof.commitment.toString()
        };

        const inputFile = path.join(__dirname, '../../', 'circuit_artifacts', `input${i + 1}.json`);
        writeFileSync(inputFile, JSON.stringify(inputData, null, 2));
        console.log(`Created ${inputFile} (index: ${proof.index})`);
    });
};

module.exports = { generateCommitments };