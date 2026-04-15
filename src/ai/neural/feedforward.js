/**
 * Pure JS feedforward neural network.
 * No dependencies. Supports arbitrary topology.
 *
 * Forward pass: multiply-accumulate per layer, ReLU on hidden layers, raw output.
 * Weight layout (flat): for each layer pair, weights (prevSize * currSize) then biases (currSize).
 */

export class FeedforwardNetwork {
  /**
   * @param {number[]} topology — e.g. [53, 32, 16, 4]
   */
  constructor(topology) {
    this.topology = topology;
    this._layers = [];

    for (let l = 1; l < topology.length; l++) {
      const prevSize = topology[l - 1];
      const currSize = topology[l];
      this._layers.push({
        weights: new Float32Array(prevSize * currSize),
        biases: new Float32Array(currSize),
      });
    }
  }

  /** Total number of trainable parameters */
  get weightCount() {
    let count = 0;
    for (const layer of this._layers) {
      count += layer.weights.length + layer.biases.length;
    }
    return count;
  }

  /** Extract all weights as a flat Float32Array (genome) */
  getWeights() {
    const flat = new Float32Array(this.weightCount);
    let offset = 0;
    for (const layer of this._layers) {
      flat.set(layer.weights, offset);
      offset += layer.weights.length;
      flat.set(layer.biases, offset);
      offset += layer.biases.length;
    }
    return flat;
  }

  /** Load weights from a flat Float32Array */
  setWeights(flat) {
    if (flat.length !== this.weightCount) {
      throw new Error(`Expected ${this.weightCount} weights, got ${flat.length}`);
    }
    let offset = 0;
    for (const layer of this._layers) {
      layer.weights.set(flat.subarray(offset, offset + layer.weights.length));
      offset += layer.weights.length;
      layer.biases.set(flat.subarray(offset, offset + layer.biases.length));
      offset += layer.biases.length;
    }
  }

  /**
   * Forward pass.
   * @param {Float32Array|number[]} input
   * @returns {Float32Array} output layer activations (raw — no activation on final layer)
   */
  forward(input) {
    let activation = input instanceof Float32Array ? input : new Float32Array(input);

    for (let l = 0; l < this._layers.length; l++) {
      const { weights, biases } = this._layers[l];
      const prevSize = activation.length;
      const currSize = biases.length;
      const output = new Float32Array(currSize);

      for (let j = 0; j < currSize; j++) {
        let sum = biases[j];
        const wOffset = j * prevSize;
        for (let i = 0; i < prevSize; i++) {
          sum += weights[wOffset + i] * activation[i];
        }
        // ReLU on hidden layers, raw on output
        output[j] = (l < this._layers.length - 1) ? Math.max(0, sum) : sum;
      }

      activation = output;
    }

    return activation;
  }

  /** Serialize to plain object */
  toJSON() {
    return {
      topology: [...this.topology],
      weights: Array.from(this.getWeights()),
    };
  }

  /** Reconstruct from serialized object */
  static fromJSON(json) {
    const net = new FeedforwardNetwork(json.topology);
    net.setWeights(new Float32Array(json.weights));
    return net;
  }
}
