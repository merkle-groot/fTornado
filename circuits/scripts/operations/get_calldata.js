const { getGroth16CallData, CurveId, init } = require('garaga');
const { writeFileSync } = require('fs');
const path = require('path');
const { CONFIG } = require('../lib/config.js');
const { loadJson, toBigInt, formatPoint, formatG2Point } = require('../lib/utils.js');

const getCalldata  = async(i) => {
    const curveId = CurveId.BN254;

    // Resolve all files relative to this script's directory so CWD doesn't matter
    const proofPath = path.join(__dirname, '..', '..', 'circuit_artifacts', 'proofs', `proof${i}.json`);
    const publicPath = path.join(__dirname, '..', '..', 'circuit_artifacts', 'proofs', `public${i}.json`);
    const vkPath = path.join(__dirname, '..', '..', 'circuit_artifacts', 'verification_key.json');

    const proof = loadJson(proofPath);
    const publicInputs = loadJson(publicPath);
    const vk = loadJson(vkPath);

    const groth16Proof = {
        a: formatPoint(proof.pi_a[0], proof.pi_a[1], curveId),
        b: formatG2Point(proof.pi_b[0], proof.pi_b[1], curveId),
        c: formatPoint(proof.pi_c[0], proof.pi_c[1], curveId),
        publicInputs: publicInputs.map(toBigInt),
        curveId
    };

    const verificationKey = {
        alpha: formatPoint(vk.vk_alpha_1[0], vk.vk_alpha_1[1], curveId),
        beta: formatG2Point(vk.vk_beta_2[0], vk.vk_beta_2[1], curveId),
        gamma: formatG2Point(vk.vk_gamma_2[0], vk.vk_gamma_2[1], curveId),
        delta: formatG2Point(vk.vk_delta_2[0], vk.vk_delta_2[1], curveId),
        ic: vk.IC.map(point => formatPoint(point[0], point[1], curveId))
    };

    let calldata = getGroth16CallData(groth16Proof, verificationKey, curveId);

    const calldataPath = path.join(__dirname, '..', '..', '..', 'contracts', 'tests', `calldata${i}.json`);
    writeFileSync(
        calldataPath,
        JSON.stringify(
            { calldata: calldata.map((val) => val.toString()) },
            null,
            2
        )
    );
}

const getCalldatas = async() => {
    await init();

    const proofIndices = Array.from({ length: CONFIG.numProofs }, (_, i) => i + 1);
    for (const proofIndex of proofIndices) {
        await getCalldata(proofIndex);
    }
}

module.exports = {getCalldatas};