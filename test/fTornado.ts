import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { FTornado, MockERC20 } from "../types";
import { expect } from "chai";
// @ts-ignore - JS module without types
import {MerkleTree} from "../circuits/tests/helpers/merkleTree";
// @ts-ignore - JS module without types
import {hash as PoseidonHash} from "../circuits/tests/helpers/poseidon";
import { ZKProofGenerator, generateCircuitInput } from "./helpers/zkProof";

async function deployFixture() {
  const [deployer, alice, bob] = await ethers.getSigners();

  // Deploy PoseidonT3 library
  const poseidonT3Factory = await ethers.getContractFactory("PoseidonT3");
  const poseidonT3 = await poseidonT3Factory.deploy();
  await poseidonT3.waitForDeployment();
  const poseidonT3Address = await poseidonT3.getAddress();

  // Deploy Mock ERC20 token
  const mockTokenFactory = await ethers.getContractFactory("MockERC20");
  const mockToken = await mockTokenFactory.deploy("Mock Token", "MOCK");
  await mockToken.waitForDeployment();

  // Deploy Verifier contract
  const verifierFactory = await ethers.getContractFactory("Groth16Verifier");
  const verifier = await verifierFactory.deploy();
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();

  // Deploy fTornado contract
  const denomination = ethers.parseEther("1");

  const fTornadoFactory = await ethers.getContractFactory("fTornado", {
    libraries: {
      PoseidonT3: poseidonT3Address,
    },
  });

  // Calculate future contract address
  const nonce = await ethers.provider.getTransactionCount(deployer.address);
  const expectedAddress = ethers.getCreateAddress({
    from: deployer.address,
    nonce: nonce,
  });

  // Create encrypted input
  const encryptedDenomination = fhevm.createEncryptedInput(
    expectedAddress,
    deployer.address
  );
  encryptedDenomination.add64(denomination);
  const encryptedInput = await encryptedDenomination.encrypt();

  const fTornado = await fTornadoFactory.deploy(
    verifierAddress,
    denomination,
    ethers.hexlify(encryptedInput.handles[0]),
    encryptedInput.inputProof,
    await mockToken.getAddress()
  );
  await fTornado.waitForDeployment();

  // Mint tokens to alice
  await mockToken.mint(alice.address, ethers.parseEther("100"));

  return { fTornado, mockToken, denomination };
}

describe("fTornado - Deposit Happy Path", function () {
  let alice: HardhatEthersSigner;
  let fTornado: FTornado;
  let mockToken: MockERC20;
  let denomination: bigint;
  let merkleTree: MerkleTree;

  before(async function () {
    const [, _alice] = await ethers.getSigners();
    alice = _alice;
    merkleTree = new MerkleTree(31); // Use 31 levels to match the contract and circuit
    await merkleTree.init();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      this.skip();
    }
    const fixture = await deployFixture();
    fTornado = fixture.fTornado;
    mockToken = fixture.mockToken;
    denomination = fixture.denomination;
  });

  it("should successfully deposit funds with a valid commitment", async function () {
    // Generate random nullifier and secret
    const nullifier = BigInt(ethers.hexlify(ethers.randomBytes(32)));
    const secret = BigInt(ethers.hexlify(ethers.randomBytes(32)));

    // Simple commitment = hash(nullifier, secret) using Poseidon hash
    const commitmentBigInt = await merkleTree.getHash(secret, nullifier);
    // Convert BigInt to bytes32 hex string (32 bytes = 64 hex chars)
    const commitment = ethers.zeroPadValue(ethers.toBeHex(commitmentBigInt), 32);

    // Approve tokens
    await mockToken.connect(alice).approve(await fTornado.getAddress(), denomination);

    // Get balances before
    const aliceBalanceBefore = await mockToken.balanceOf(alice.address);
    const contractBalanceBefore = await mockToken.balanceOf(await fTornado.getAddress());

    // Deposit
    const tx = await fTornado.connect(alice).deposit(commitment, alice.address);
    await tx.wait();

    await merkleTree.insert(commitmentBigInt);

    // Check balances after
    const aliceBalanceAfter = await mockToken.balanceOf(alice.address);
    const contractBalanceAfter = await mockToken.balanceOf(await fTornado.getAddress());

    // Verify tokens were transferred
    expect(aliceBalanceAfter).to.equal(aliceBalanceBefore - denomination);
    expect(contractBalanceAfter).to.equal(contractBalanceBefore + denomination);

    // Verify commitment was recorded
    const commitmentExists = await fTornado.commitments(commitment);
    expect(commitmentExists).to.be.true;

    const currentRoot = await fTornado.getLastRoot();
    expect(currentRoot).to.equal(merkleTree.getRoot());

    // Verify nextIndex incremented
    const nextIndex = await fTornado.nextIndex();
    expect(nextIndex).to.equal(1);

    // Verify Deposit event
    const logs = await fTornado.queryFilter(fTornado.filters.Deposit());
    expect(logs.length).to.equal(1);
  });
});

describe("fTornado - Withdraw Happy Path", function () {
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let fTornado: FTornado;
  let mockToken: MockERC20;
  let denomination: bigint;
  let merkleTree: MerkleTree;

  before(async function () {
    const [, _alice, _bob] = await ethers.getSigners();
    alice = _alice;
    bob = _bob;
    merkleTree = new MerkleTree(31); // Use 31 levels to match the contract and circuit
    await merkleTree.init();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      this.skip();
    }
    const fixture = await deployFixture();
    fTornado = fixture.fTornado;
    mockToken = fixture.mockToken;
    denomination = fixture.denomination;
  });

  it("should successfully withdraw using dynamically generated zk proof", async function () {
    // Step 1: Generate and store a commitment
    // Use values within the Baby Jubjub field size (~2^251)
    const fieldSize = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
    const nullifier = BigInt(ethers.hexlify(ethers.randomBytes(20))) % fieldSize;
    const secret = BigInt(ethers.hexlify(ethers.randomBytes(20))) % fieldSize;

    const commitmentBigInt = await merkleTree.getHash(secret, nullifier);
    const commitment = ethers.zeroPadValue(ethers.toBeHex(commitmentBigInt), 32);

    // Deposit tokens
    await mockToken.connect(alice).approve(await fTornado.getAddress(), denomination);
    const depositTx = await fTornado.connect(alice).deposit(commitment, alice.address);
    await depositTx.wait();

    // Insert into merkle tree
    await merkleTree.insert(commitmentBigInt);

    console.log("JS merkle tree root: ", merkleTree.getRoot().toString(16));
    console.log("contract root: ", await fTornado.getLastRoot());

    // Step 2: Generate nullifier hash using Poseidon(1)
    const nullifierHashBigInt = await merkleTree.getHashN([nullifier]);
    const nullifierHash = ethers.zeroPadValue(ethers.toBeHex(nullifierHashBigInt), 32);

    // Step 3: Get merkle proof
    const index = merkleTree.getIndex(commitmentBigInt);
    const merklePath = merkleTree.getPath(index);
    const rootBigInt = merkleTree.getRoot();
    const root = ethers.zeroPadValue(ethers.toBeHex(rootBigInt), 32);
    const relayer = bob;
    const fee = ethers.parseEther("0.03");
    const refund = ethers.parseEther("0.01");

    console.log("Merkle path siblings length:", merklePath.siblings.length);
    console.log("Merkle path isLeft length:", merklePath.isLeft.length);

    // Step 4: Generate circuit inputs
    // For withdraw: isWithdraw = 1
    const circuitInput = generateCircuitInput(
      nullifier,
      secret,
      merklePath,
      rootBigInt,
      alice.address,
      31, // Tree depth to match contract and circuit
      relayer.address, 
      fee,
      refund
    );

    // Calculate commitment and nullifierHash for circuit input
    circuitInput.commitment = commitmentBigInt.toString();
    circuitInput.nullifierHash = nullifierHashBigInt.toString();

    // Debug: save circuit input for inspection
    const proofGen = new ZKProofGenerator("wrapOrWithdraw");
    proofGen.saveInput(circuitInput, "withdraw_test_input.json");

    // Step 5: Generate zk-SNARK proof
    console.log("Generating zk-SNARK proof...");
    const proofData = await proofGen.generateProof(circuitInput);

    console.log("Proof generated successfully!");
    console.log("Public signals:", proofData.publicSignals);

    // Debug: Compare roots
    const proofRoot = proofData.publicSignals[0];
    const proofRootBigInt = BigInt(proofRoot);
    const proofRootHex = ethers.zeroPadValue(ethers.toBeHex(proofRootBigInt), 32);

    console.log("Root from proof:", proofRoot);
    console.log("Root from proof (hex):", proofRootHex);
    console.log("Root from test:", rootBigInt.toString());
    console.log("Root from test (hex):", root);
    console.log("Contract last root:", await fTornado.getLastRoot());

    // Check if root is known
    const knownRoot = await fTornado.isKnownRoot(root);
    console.log("Is test root known?", knownRoot);

    const knownRootFromProof = await fTornado.isKnownRoot(proofRootHex);
    console.log("Is proof root known?", knownRootFromProof);

    // Use the proof root since that's what the circuit verified
    const rootForContract = proofRootHex;

    // Get balances before
    const aliceBalanceBefore = await mockToken.balanceOf(alice.address);
    const contractBalanceBefore = await mockToken.balanceOf(await fTornado.getAddress());

    // Step 6: Encode proof for contract call
    // The verifier expects: pA (uint[2]), pB (uint[2][2]), pC (uint[2])
    // We need to ABI encode these together
    // Our proof format is: [pi_a[0], pi_a[1], pi_b[0][1], pi_b[0][0], pi_b[1][1], pi_b[1][0], pi_c[0], pi_c[1]]
    // We need to reformat to: pA=[pi_a[0], pi_a[1]], pB=[[pi_b[0][0], pi_b[0][1]], [pi_b[1][0], pi_b[1][1]]], pC=[pi_c[0], pi_c[1]]
    const pA = [proofData.proof[0], proofData.proof[1]];
    const pB = [
      [proofData.proof[3], proofData.proof[2]], // Note: swapped due to our storage format
      [proofData.proof[5], proofData.proof[4]]
    ];
    const pC = [proofData.proof[6], proofData.proof[7]];

    // ABI encode the proof components as expected by the verifier
    const proofEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256[2]", "uint256[2][2]", "uint256[2]"],
      [pA, pB, pC]
    );

    // Step 7: Call withdraw with proof
    const withdrawTx = await fTornado.connect(alice).withdraw(
      proofEncoded,
      rootForContract,
      alice.address,
      nullifierHash,
      relayer.address,
      fee,
      refund
    );
    await withdrawTx.wait();

    // Verify balances changed
    const aliceBalanceAfter = await mockToken.balanceOf(alice.address);
    const contractBalanceAfter = await mockToken.balanceOf(await fTornado.getAddress());

    expect(aliceBalanceAfter).to.equal(aliceBalanceBefore + denomination);
    expect(contractBalanceAfter).to.equal(contractBalanceBefore - denomination);

    // Verify nullifier was spent
    const isSpent = await fTornado.isSpent(nullifierHash);
    expect(isSpent).to.be.true;

    // Verify Wrap event (both wrap and withdraw emit Wrap)
    const wrapLogs = await fTornado.queryFilter(fTornado.filters.Wrap());
    expect(wrapLogs.length).to.equal(1);
    expect(wrapLogs[0].args[0]).to.equal(alice.address);
    expect(wrapLogs[0].args[1]).to.equal(nullifierHash);

    console.log("Withdraw test completed successfully!");
  });
});
