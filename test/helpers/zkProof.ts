// @ts-ignore - JS module without types
import * as snarkjs from "snarkjs";
import * as fs from "fs";
import * as path from "path";
import { ethers } from "hardhat";

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
  async generateProof(
    nullifier: bigint,
    secret: bigint,
    merklePath: { siblings: bigint[]; isLeft: boolean[] },
    root: bigint,
    recipient: string,
    treeDepth: number = 31,
    relayer: string,
    fee: bigint,
    refund: bigint,
    commitment: string,
    nullifierHash: string
  ): Promise<ProofData> {
    // Verify files exist
    if (!fs.existsSync(this.wasmFile)) {
      throw new Error(`WASM file not found: ${this.wasmFile}`);
    }
    if (!fs.existsSync(this.zkeyFile)) {
      throw new Error(`Zkey file not found: ${this.zkeyFile}`);
    }

    const input = {
      root: root,
      receiver: recipient,
      siblings: merklePath.siblings,
      isLeft: merklePath.isLeft,
      nullifier: nullifier,
      nullifierHash: nullifierHash,
      secretKey: secret,
      commitment: commitment,
      relayer: relayer,
      fee: fee,
      refund: refund,
    };

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
      proof.pi_b[0][1],
      proof.pi_b[0][0],
      proof.pi_b[1][1],
      proof.pi_b[1][0],
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