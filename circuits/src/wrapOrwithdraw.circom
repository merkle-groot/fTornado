pragma circom 2.0.4;

include "./merkle_proof_checker.circom";
include "../../node_modules/circomlib/circuits/poseidon.circom";

template CommitmentChecker() {
    signal input nullifier;
    signal input nullifierHash;
    signal input secretKey;
    signal input commitment;

    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== secretKey;
    commitmentHasher.inputs[1] <== nullifier;

    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs[0] <== nullifier;

    commitment === commitmentHasher.out;
    nullifierHash === nullifierHasher.out;
}

template wrapOrWithdraw(nLevels) {
    signal input root;
    // bind the receiver to the proof
    signal input receiver;
	signal input siblings[nLevels];
	signal input isLeft[nLevels];
    signal input nullifier;
    signal input nullifierHash;
    signal input secretKey;
    signal input commitment;
    signal input relayer;
    signal input fee;
    signal input refund;


    // check existense proof
    component merkleVerifier = MerkleVerifier(nLevels);
    merkleVerifier.root <== root;
    merkleVerifier.commitment <== commitment;

    for(var i = 0; i < nLevels; i++){
        merkleVerifier.siblings[i] <== siblings[i];
        merkleVerifier.isLeft[i] <== isLeft[i];
    }

    // check commitment validity
    component commitmentChecker = CommitmentChecker();
    commitmentChecker.nullifier <== nullifier;
    commitmentChecker.nullifierHash <== nullifierHash;
    commitmentChecker.secretKey <== secretKey;
    commitmentChecker.commitment <== commitment;
}

component main{public [root, receiver, nullifierHash, relayer, fee, refund]} = wrapOrWithdraw(31);