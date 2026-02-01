const path = require("path");

// Resolve script paths relative to this file so they work from any CWD
const SCRIPTS = {
  setup: path.join(__dirname, "..", "bash_scripts", "setup.sh"),
  proof: path.join(__dirname, "..", "bash_scripts", "proof_gen.sh")
};

const CONFIG = {
  merkleLevels: 32,
  numCommitments: 64,
  numProofs: 3,
  valueRanges: {
    secretKey: [1n, 1000000000000n],
    nullifier: [1n, 1000000000000n],
    receiver: [1000n, 10000n]
  }
};

module.exports = { SCRIPTS, CONFIG };