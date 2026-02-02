import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { FTornado, MockERC20 } from "../types";
import { expect } from "chai";
// @ts-ignore - JS module without types
import {MerkleTree} from "../circuits/tests/helpers/merkleTree";
// @ts-ignore - JS module without types
import { ZKProofGenerator, proofToCalldata } from "./helpers/zkProof";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { Block } from "ethers";

const PRIME_FIELD = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
const denomination = BigInt(ethers.parseUnits("100", 6));

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
  await mockToken.mint(alice.address, denomination);
  console.log("parsed denomination: ", ethers.parseUnits(denomination.toString(), 6));

  return { fTornado, mockToken, denomination };
}

const commitmentSecrets = [
  {
    nullifier: BigInt(9857942516180942539335783964621905148073162322717950192456940533337276755360),
    secret: BigInt(6835794491428280442979705836456672210441037606657104448389088280378681774396)
  },
  {
    nullifier: BigInt(3268375155020650123385487475560473930106948157978451156747513041063369456701),
    secret: BigInt(17702716768249716268906960996209075543506739633148799285932104899624515661358)
  }
];

async function deposit(fTornado: FTornado, mockToken: MockERC20, commitment: string, alice: HardhatEthersSigner) {
  // Approve tokens
  await mockToken.connect(alice).approve(await fTornado.getAddress(), denomination);

  // Deposit
  const tx = await fTornado.connect(alice).deposit(commitment);
  await tx.wait();
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
      // Select secret and nullifier
      const secret = commitmentSecrets[0].secret;
      const nullifier = commitmentSecrets[0].nullifier;

      // Simple commitment = hash(nullifier, secret) using Poseidon hash
      const commitmentBigInt = await merkleTree.getHash(secret, nullifier);
      // Convert BigInt to bytes32 hex string (32 bytes = 64 hex chars)
      const commitment = ethers.zeroPadValue(ethers.toBeHex(commitmentBigInt), 32);

      // insert to js merkle tree
      await merkleTree.insert(commitmentBigInt);

       // Get balances before
      const aliceBalanceBefore = await mockToken.balanceOf(alice.address);
      const contractBalanceBefore = await mockToken.balanceOf(await fTornado.getAddress());
        
      // call deposit
      await mockToken.connect(alice).approve(await fTornado.getAddress(), denomination);

      // Deposit
      const block: Block | null = await ethers.provider.getBlock("latest");
      await expect(
        await fTornado.connect(alice).deposit(commitment)
      ).to.emit(
        fTornado,
        "Deposit"
      ).withArgs(
        commitment,
        0,
        block!.number + 1
      );

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
    // Select secret and nullifier
    const secret = commitmentSecrets[0].secret;
    const nullifier = commitmentSecrets[0].nullifier;

    const commitmentBigInt = await merkleTree.getHash(secret, nullifier);
    const commitment = ethers.zeroPadValue(ethers.toBeHex(commitmentBigInt), 32);

    // Insert into merkle tree
    await merkleTree.insert(commitmentBigInt);

    await deposit(fTornado, mockToken, commitment, alice);
   
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
    
    // Debug: save circuit input for inspection
    const proofGen = new ZKProofGenerator("wrapOrWithdraw");

    // Step 5: Generate zk-SNARK proof
    console.log("Generating zk-SNARK proof...");
    const proofData = await proofGen.generateProof(
      nullifier,
      secret,
      merklePath,
      rootBigInt,
      alice.address,
      31, // Tree depth to match contract and circuit
      relayer.address, 
      fee,
      refund,
      commitment,
      nullifierHash
    );
    const encodedProof = proofToCalldata(proofData.proof);

    const aliceBalanceBefore = await mockToken.balanceOf(alice.address);
    const contractBalanceBefore = await mockToken.balanceOf(await fTornado.getAddress());

    // Step 7: Call withdraw with proof
    const block: Block | null = await ethers.provider.getBlock("latest");
    await expect(
      await fTornado.connect(alice).withdraw(
        encodedProof,
        root,
        alice.address,
        nullifierHash,
        relayer.address,
        fee,
        refund
      )
    ).to.emit(
      fTornado,
      "Withdraw"
    ).withArgs(
      alice.address,
      nullifierHash,
      block!.number + 1
    );

    // Verify balances changed
    const aliceBalanceAfter = await mockToken.balanceOf(alice.address);
    const contractBalanceAfter = await mockToken.balanceOf(await fTornado.getAddress());

    expect(aliceBalanceAfter).to.equal(aliceBalanceBefore + denomination);
    expect(contractBalanceAfter).to.equal(contractBalanceBefore - denomination);

    // Verify nullifier was spent
    const isSpent = await fTornado.isSpent(nullifierHash);
    expect(isSpent).to.be.true;

    console.log("Withdraw test completed successfully!");
  });
});

describe("fTornado - Wrap Happy Path", function () {
  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let fTornado: FTornado;
  let mockToken: MockERC20;
  let denomination: bigint;
  let merkleTree: MerkleTree;

  before(async function () {
    const [_deployer, _alice, _bob] = await ethers.getSigners();
    alice = _alice;
    bob = _bob;
    deployer = _deployer;
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

  it("should successfully wrap using dynamically generated zk proof", async function () {
    // Select secret and nullifier
    const secret = commitmentSecrets[0].secret;
    const nullifier = commitmentSecrets[0].nullifier;

    const commitmentBigInt = await merkleTree.getHash(secret, nullifier);
    const commitment = ethers.zeroPadValue(ethers.toBeHex(commitmentBigInt), 32);

    // Deposit tokens
    await deposit(fTornado, mockToken, commitment, alice);

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
    
    // Debug: save circuit input for inspection
    const proofGen = new ZKProofGenerator("wrapOrWithdraw");

    // Step 5: Generate zk-SNARK proof
    console.log("Generating zk-SNARK proof...");
    const proofData = await proofGen.generateProof(
      nullifier,
      secret,
      merklePath,
      rootBigInt,
      alice.address,
      31, // Tree depth to match contract and circuit
      relayer.address, 
      fee,
      refund,
      commitment,
      nullifierHash
    );
    const encodedProof = proofToCalldata(proofData.proof);

    const aliceBalanceBefore = await fTornado.confidentialBalanceOf(alice.address);

    // Step 7: Call withdraw with proof
    const block: Block | null = await ethers.provider.getBlock("latest");
    await expect(
      fTornado.connect(alice).wrap(
        encodedProof,
        root,
        alice.address,
        nullifierHash,
        relayer.address,
        fee,
        refund
      )
    ).to.emit(
      fTornado,
      "Wrap"
    ).withArgs(
      alice.address,
      nullifierHash,
      block!.number + 1
    );

    // Verify balances changed
    const aliceBalanceAfter = await fTornado.confidentialBalanceOf(alice.address);

    console.log(aliceBalanceBefore, aliceBalanceAfter);

    const aliceClearBalanceAfter = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      aliceBalanceAfter,
      fTornado,
      alice
    );
    
    expect(aliceClearBalanceAfter).to.be.equal(denomination);
  });
});


describe("fTornado - UnWrap Happy path", function () {
  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let fTornado: FTornado;
  let mockToken: MockERC20;
  let denomination: bigint;
  let merkleTree: MerkleTree;

  before(async function () {
    const [_deployer, _alice, _bob] = await ethers.getSigners();
    alice = _alice;
    bob = _bob;
    deployer = _deployer;
    merkleTree = new MerkleTree(31); // Use 31 levels to match the contract and circuit
    await merkleTree.init();
  });

  it("should fail when insufficient balance for unwrapping", async function() {
    if (!fhevm.isMock) {
      this.skip();
    }
    const fixture = await deployFixture();
    fTornado = fixture.fTornado;
    mockToken = fixture.mockToken;
    denomination = fixture.denomination;

    // Select secret and nullifier
    const secret = commitmentSecrets[0].secret;
    const nullifier = commitmentSecrets[0].nullifier;

    const commitmentBigInt = await merkleTree.getHash(secret, nullifier);
    const commitment = ethers.zeroPadValue(ethers.toBeHex(commitmentBigInt), 32);

    // Deposit tokens
    await deposit(fTornado, mockToken, commitment, alice);

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
    
    // Debug: save circuit input for inspection
    const proofGen = new ZKProofGenerator("wrapOrWithdraw");

    // Step 5: Generate zk-SNARK proof
    console.log("Generating zk-SNARK proof...");
    const proofData = await proofGen.generateProof(
      nullifier,
      secret,
      merklePath,
      rootBigInt,
      alice.address,
      31, // Tree depth to match contract and circuit
      relayer.address, 
      fee,
      refund,
      commitment,
      nullifierHash
    );
    const encodedProof = proofToCalldata(proofData.proof);

    // Step 7: Call wrap with proof
    const wrapTx = await fTornado.connect(alice).wrap(
      encodedProof,
      root,
      alice.address,
      nullifierHash,
      relayer.address,
      fee,
      refund
    );
    await wrapTx.wait();
 
    // make a transfer to reduce ALice's balance
    const transferAmount = ethers.parseUnits("5", 6);
    const encryptedInput = await fhevm
        .createEncryptedInput(await fTornado.getAddress(), alice.address)
        .add64(transferAmount)
        .encrypt();

    await fTornado.connect(alice)["confidentialTransfer(address,bytes32,bytes)"](
      bob.address,
      encryptedInput.handles[0],
      encryptedInput.inputProof
    );

    // unwrap
    // Select secret and nullifier
    const secret1 = commitmentSecrets[1].secret;
    const nullifier1 = commitmentSecrets[1].nullifier;

    const commitmentWrapBigInt = await merkleTree.getHash(secret1, nullifier1);
    const commitmentWrap = ethers.zeroPadValue(ethers.toBeHex(commitmentWrapBigInt), 32);

    // uwrap tx
    const tx = await fTornado.connect(alice).unwrap(commitmentWrap);
    const receipt = await tx.wait();
    const pendingUnwrapIndex = receipt!.index;

    const pendingUnwrap = await fTornado.getPendingUnwrap(pendingUnwrapIndex);
    const publicDecryptResults = await fhevm.publicDecrypt([pendingUnwrap[2]]);

    console.log(publicDecryptResults);
    const decryptedAmount = ethers.AbiCoder.defaultAbiCoder().decode(
      ["uint256"],
      publicDecryptResults.abiEncodedClearValues
    );

    expect(decryptedAmount[0]).to.be.equal(0);

    const block: Block | null = await ethers.provider.getBlock("latest");
    await expect(
      fTornado.connect(alice).finalizeUnwrap(
        pendingUnwrapIndex!,
        publicDecryptResults.abiEncodedClearValues, publicDecryptResults.decryptionProof
      )
    ).to.emit(
      fTornado,
      "UnwrapFailed"
    ).withArgs(
      alice.address,
      commitmentWrap,
      pendingUnwrap[2],
      pendingUnwrapIndex,
      block!.number + 1
    );
  });
});

describe("fTornado - UnWrap Unhappy path", function () {
  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let fTornado: FTornado;
  let mockToken: MockERC20;
  let denomination: bigint;
  let merkleTree: MerkleTree;

  before(async function () {
    const [_deployer, _alice, _bob] = await ethers.getSigners();
    alice = _alice;
    bob = _bob;
    deployer = _deployer;
    merkleTree = new MerkleTree(31); // Use 31 levels to match the contract and circuit
    await merkleTree.init();
  });

  it("should successfully unwrap tokens", async function () {
    if (!fhevm.isMock) {
      this.skip();
    }
    const fixture = await deployFixture();
    fTornado = fixture.fTornado;
    mockToken = fixture.mockToken;
    denomination = fixture.denomination;

    // Select secret and nullifier
    const secret = commitmentSecrets[0].secret;
    const nullifier = commitmentSecrets[0].nullifier;

    const commitmentBigInt = await merkleTree.getHash(secret, nullifier);
    const commitment = ethers.zeroPadValue(ethers.toBeHex(commitmentBigInt), 32);

    // Deposit tokens
    await deposit(fTornado, mockToken, commitment, alice);

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
    
    // Debug: save circuit input for inspection
    const proofGen = new ZKProofGenerator("wrapOrWithdraw");

    // Step 5: Generate zk-SNARK proof
    console.log("Generating zk-SNARK proof...");
    const proofData = await proofGen.generateProof(
      nullifier,
      secret,
      merklePath,
      rootBigInt,
      alice.address,
      31, // Tree depth to match contract and circuit
      relayer.address, 
      fee,
      refund,
      commitment,
      nullifierHash
    );
    const encodedProof = proofToCalldata(proofData.proof);

    // Step 7: Call wrap with proof
    const wrapTx = await fTornado.connect(alice).wrap(
      encodedProof,
      root,
      alice.address,
      nullifierHash,
      relayer.address,
      fee,
      refund
    );
    await wrapTx.wait();
    // Unwrap
    // Select secret and nullifier
    const secret1 = commitmentSecrets[1].secret;
    const nullifier1 = commitmentSecrets[1].nullifier;

    const commitmentWrapBigInt = await merkleTree.getHash(secret1, nullifier1);
    const commitmentWrap = ethers.zeroPadValue(ethers.toBeHex(commitmentWrapBigInt), 32);

    // unwrap tokens
    const tx = await fTornado.connect(alice).unwrap(commitmentWrap);
    const receipt = await tx.wait();
    const pendingUnwrapIndex = receipt!.index;

    const pendingUnwrap = await fTornado.getPendingUnwrap(pendingUnwrapIndex);
    const publicDecryptResults = await fhevm.publicDecrypt([pendingUnwrap[2]]);

    const block: Block | null = await ethers.provider.getBlock("latest");
    await expect( 
      fTornado.connect(alice).finalizeUnwrap(
        pendingUnwrapIndex!,
        publicDecryptResults.abiEncodedClearValues, publicDecryptResults.decryptionProof
      )
    )
    .to.emit(
      fTornado,
      "UnwrapFinalized"
    ).withArgs(
      alice.address,
      commitmentWrap,
      pendingUnwrap[2],
      pendingUnwrapIndex,
      block!.number + 1
    )
    .to.emit(
      fTornado,
      "ConfidentialTransfer"
    );

    // the struct must be deleted
    const pendingUnwrap2 = await fTornado.getPendingUnwrap(pendingUnwrapIndex);
    expect(pendingUnwrap2[0]).to.equal(0n);
  });
});
