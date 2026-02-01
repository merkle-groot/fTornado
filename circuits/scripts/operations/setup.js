const { SCRIPTS } = require("../lib/config.js");
const { runScript } = require("../lib/utils.js");

const runSetup = async () => {
    console.log("Running setup script...");
    await runScript(SCRIPTS.setup);
};

module.exports = { runSetup };