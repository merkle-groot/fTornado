// @ts-ignore - JS module without types
import * as snarkjs from "snarkjs";
import * as fs from "fs";
import * as path from "path";
import { ethers } from "hardhat";

export interface CircuitInput {
  root: string;
  receiver: string;
  siblings: string[];
  isLeft: number[];
  nullifier: string;
  nullifierHash: string;
  secretKey: string;
  commitment: string;
  relayer: string;
  fee: string;
  refund: string;
}

export interface ProofData {
  proof: string[];
  publicSignals: string[];
}

export class ZKProofGenerator {
  private artifactsDir: string;
  private wasmFile: string;
  private zkeyFile: string;

  constructor(circuitType: "withdraw" | "wrapOrWithdraw" = "wrapOrWithdraw") {
    // Paths relative to project root
    this.artifactsDir = path.join(__dirname, "../../circuits/circuit_artifacts");

    if (circuitType === "wrapOrWithdraw") {
      this.wasmFile = path.join(this.artifactsDir, "wrapOrWithdraw_js/wrapOrWithdraw.wasm");
      this.zkeyFile = path.join(this.artifactsDir, "ptau/WrapOrWithdraw_final.zkey");
    } else {
      this.wasmFile = path.join(this.artifactsDir, "withdraw_js/withdraw.wasm");
      this.zkeyFile = path.join(this.artifactsDir, "ptau/Withdraw_final.zkey");
    }
  }

  /**
   * Generate a zk-SNARK proof from circuit inputs
   */
  async generateProof(input: CircuitInput): Promise<ProofData> {
    // Verify files exist
    if (!fs.existsSync(this.wasmFile)) {
      throw new Error(`WASM file not found: ${this.wasmFile}`);
    }
    if (!fs.existsSync(this.zkeyFile)) {
      throw new Error(`Zkey file not found: ${this.zkeyFile}`);
    }

    console.log("Generating witness...");
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      this.wasmFile,
      this.zkeyFile
    );

    console.log("proof is: ", proof);

    // Format proof for contract call
    // Format: [pi_a[0], pi_a[1], pi_b[0][1], pi_b[0][0], pi_b[1][1], pi_b[1][0], pi_c[0], pi_c[1]]
    const formattedProof = this.formatProof(proof);

    return {
      proof: formattedProof,
      publicSignals,
    };
  }

  /**
   * Format proof for Solidity contract call
   */
  formatProof(proof: any): string[] {
    return [
      proof.pi_a[0],
      proof.pi_a[1],
      proof.pi_b[0][0],
      proof.pi_b[0][1],
      proof.pi_b[1][0],
      proof.pi_b[1][1],
      proof.pi_c[0],
      proof.pi_c[1],
    ].map((val) => ethers.toBeHex(val));
  }

  /**
   * Verify a proof against the verification key
   */
  async verifyProof(proofData: ProofData): Promise<boolean> {
    const vkey = JSON.parse(
      fs.readFileSync(path.join(this.artifactsDir, "verification_key.json"), "utf8")
    );

    const res = await snarkjs.groth16.verify(
      vkey,
      proofData.publicSignals,
      this.unformatProof(proofData.proof)
    );

    return res;
  }

  /**
   * Unformat proof back to snarkjs format
   */
  private unformatProof(formattedProof: string[]): any {
    return {
      pi_a: [formattedProof[0], formattedProof[1]],
      pi_b: [
        [formattedProof[3], formattedProof[2]],
        [formattedProof[5], formattedProof[4]],
      ],
      pi_c: [formattedProof[6], formattedProof[7]],
    };
  }

  /**
   * Save input to file for debugging
   */
  saveInput(input: CircuitInput, filename: string): void {
    const dir = path.join(this.artifactsDir, "test_inputs");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path.join(dir, filename), JSON.stringify(input, null, 2));
  }

  /**
   * Load pre-generated proof (for testing with known good proofs)
   */
  static loadPreGeneratedProof(index: number): ProofData {
    const proofsDir = path.join(__dirname, "../../circuits/circuit_artifacts/proofs");
    const proof = JSON.parse(fs.readFileSync(path.join(proofsDir, `proof${index}.json`), "utf-8"));
    const publicSignals = JSON.parse(fs.readFileSync(path.join(proofsDir, `public${index}.json`), "utf-8"));

    return {
      proof: ZKProofGenerator.formatProofStatic(proof),
      publicSignals,
    };
  }

  /**
   * Static helper to format proof
   */
  static formatProofStatic(proof: any): string[] {
    return [
      proof.pi_a[0],
      proof.pi_a[1],
      proof.pi_b[0][1],
      proof.pi_b[0][0],
      proof.pi_b[1][1],
      proof.pi_b[1][0],
      proof.pi_c[0],
      proof.pi_c[1],
    ].map((val) => {
      // Convert to BigInt if it's a string number, then to hex
      const bigIntVal = typeof val === "string" ? BigInt(val) : val;
      return ethers.toBeHex(bigIntVal);
    });
  }
}

/**
 * Helper function to generate circuit input from test data
 */
export function generateCircuitInput(
  nullifier: bigint,
  secret: bigint,
  merklePath: { siblings: bigint[]; isLeft: boolean[] },
  root: bigint,
  recipient: string,
  treeDepth: number = 31,
  relayer: string,
  fee: bigint,
  refund: bigint
): CircuitInput {
  // Pad siblings and isLeft arrays to tree depth
  // The circuit expects exactly treeDepth elements
  const paddedSiblings: string[] = [];
  const paddedIsLeft: number[] = [];

  for (let i = 0; i < treeDepth; i++) {
    if (i < merklePath.siblings.length) {
      paddedSiblings.push(merklePath.siblings[i].toString());
      paddedIsLeft.push(merklePath.isLeft[i] ? 1 : 0);
    } else {
      // Use zero hash for missing siblings (this should be the tree's zero value)
      paddedSiblings.push("0");
      paddedIsLeft.push(0);
    }
  }

  // Convert recipient address to uint256 (address as integer)
  const recipientAsUint = BigInt(recipient).toString();

  return {
    root: root.toString(),
    receiver: recipientAsUint,
    siblings: paddedSiblings,
    isLeft: paddedIsLeft,
    nullifier: nullifier.toString(),
    nullifierHash: "", // This should be calculated using Poseidon
    secretKey: secret.toString(),
    commitment: "", // This should be calculated using Poseidon,
    relayer: relayer.toString(),
    fee: fee.toString(),
    refund: refund.toString()
  };
}

/**
 * Export proof calldata for contract calls
 */
export function proofToCalldata(proof: string[]): string {
  // Returns the calldata string for the proof
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256[8]"],
    [proof]
  );
}