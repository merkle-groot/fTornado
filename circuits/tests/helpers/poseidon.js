const { buildEddsa, buildPoseidon } = require('circomlibjs');
let poseidon;

async function initializePoseidon() {
    poseidon = await buildPoseidon();
}

async function hashN(elements) {
    if (!poseidon) {
        await initializePoseidon();
    }
    const bytesResult = await poseidon(elements);
    const bigIntHash = await poseidon.F.toObject(bytesResult);
    return bigIntHash;
}

// Hash n field elements
async function hash(left, right) {
    if (!poseidon) {
        await initializePoseidon();
    }
    const bytesResult = await poseidon([left, right]);
    const bigIntHash = await poseidon.F.toObject(bytesResult);
    return bigIntHash;
}

module.exports = {
    hash,
    hashN
};