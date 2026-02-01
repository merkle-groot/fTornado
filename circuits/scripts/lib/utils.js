const { existsSync } = require("fs");
const { exec } = require("child_process");
const path = require("path");
const crypto = require("crypto");

const runScript = async (scriptPath, ...args) => {
  if (!existsSync(scriptPath)) {
    throw new Error(`Script not found: ${scriptPath}`);
  }

  const fullPath = path.resolve(scriptPath);
  const command = `bash ${fullPath} ${args.join(' ')}`;

  console.log(`Running: ${command}`);

  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Script failed: ${error.message}`);
        if (stderr) console.error(`stderr:\n${stderr}`);
        reject(error);
      } else {
        console.log(`Script completed successfully`);
        if (stdout.trim()) console.log(stdout);
        resolve();
      }
    });
  });
};

const getRandomBigInt = (min, max) => {
  // Use Node's crypto.randomBytes instead of browser-only getRandomValues
  const randomBytes = crypto.randomBytes(8);
  let value = 0n;
  for (const byte of randomBytes) {
    value = (value << 8n) + BigInt(byte);
  }

  return min + (value % (max - min));
};

const toBigInt = (x) => {
    return typeof x === 'string' ? BigInt(x) : x;
};

const loadJson = (path) => {
    return JSON.parse(require('fs').readFileSync(path));
};

const formatPoint = (x, y, curveId) => {
    return { x: toBigInt(x), y: toBigInt(y), curveId };
};

const formatG2Point = (x, y, curveId) => {
    return {
        x: [toBigInt(x[0]), toBigInt(x[1])],
        y: [toBigInt(y[0]), toBigInt(y[1])],
        curveId
    };
};

module.exports = {
    runScript,
    getRandomBigInt,
    toBigInt,
    loadJson,
    formatPoint,
    formatG2Point
};