const { hashN } = require('./poseidon.js');

async function getCommitment(secret, nullifier) {
    const commitment = await hashN(
        [
            secret,
            nullifier
        ]
    );

    const nullifierHash = await hashN(
        [
            BigInt(nullifier)
        ]
    )
    return {
        commitment,
        nullifierHash
    }

}

module.exports = {
    getCommitment
};