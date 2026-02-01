const { hash, hashN } = require("./poseidon.js");
const DEFAULT_ZERO = 19014214495641488759237505126948346942972912379615652741039992445865937985820n;

class MerkleTree {
    constructor(levels, hashFn = hash, zeroHash = DEFAULT_ZERO) {
        this.levels = levels;   
        this.capacity = 2 ** levels;
        this._hash = hashFn;
        this.zeroHash = zeroHash;
        this._zeroSubTrees = [zeroHash];
        this._layers = [];
        this._layers[0] = [];
    }

    async init() {
        for(let i = 1; i <= this.levels; ++i){
            this._zeroSubTrees[i] = await this._hash(
                this._zeroSubTrees[i-1],
                this._zeroSubTrees[i-1]
            )
        }
    }

    async insert(element) {
        let index = this._layers[0].length;
        if(index >= this.capacity){
            throw new Error('Tree is full');
        }

        await this._insert(element, index);
    }


    getIndex(element) {
        return this._layers[0].indexOf(element)
    }

    async _insert(element, index) {
        this._layers[0][index] = element;
        for(let i = 1; i <= this.levels; ++i){
            if (!this._layers[i]) this._layers[i] = [];
            index >>= 1;
            this._layers[i][index] = await this._hash(
                this._layers[i - 1][2 * index],
                index * 2 + 1 < this._layers[i - 1].length ?
                    this._layers[i - 1][2 * index + 1] : this._zeroSubTrees[i - 1]
            );
        }
    }

    serialize() {
        // Convert BigInt to hex string for JSON serialization
        const zerosStr = this._zeroSubTrees.map(val => "0x" + val.toString(16));
        const layersStr = this._layers.map(layer =>
            layer.map(val => "0x" + val.toString(16))
        );

        return {
            levels: this.levels,
            _zeros: zerosStr,
            _layers: layersStr,
        }
    }

    getPath(index) {
        if(index < 0 || index > this.capacity){
            throw new Error("invalid index");
        }

        let isLeft = [];
        let siblings = [];
        for(let i = 0; i < this.levels; ++i){
            if(index % 2){
                isLeft.push(false);
                siblings.push(this._layers[i][index - 1]);
            } else {
                isLeft.push(true);
                siblings.push(
                    index + 1 < this._layers[i].length ?
                        this._layers[i][index + 1] : this._zeroSubTrees[i]
                );
            }
            index >>= 1;
        }

        return {
            isLeft,
            siblings
        }
    }

    getLeaves() {
        return this._layers[0].slice();
    }

    getRoot() {
        return this._layers[0].length != 0 ? this._layers[this.levels][0] : this._zeroSubTrees[this.levels];
    }

    async getHash(left, right){
        const result = await hash(left, right);
        return result;
    }

    async getHashN(elements) {
        const result = await hashN(elements);
        return result;
    }
}


// const fs = require('fs').promises;

// async function main() {
//     try {
//         const mt = new MerkleTree(33);
//         await mt.init();

//         const serialized = mt.serialize();
//         await fs.writeFile('./roots.json', JSON.stringify(serialized, null, 2));

//         console.log('Merkle tree initialized and saved to roots.json');
//         return mt;
//     } catch (error) {
//         console.error('Error in main:', error);
//         throw error;
//     }
// }

// // Run main if this file is executed directly
// if (require.main === module) {
//     main().catch(console.error);
// }

module.exports = { MerkleTree };

