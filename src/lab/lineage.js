/**
 * Lineage tracking for simulation lab.
 * Maintains an ancestry tree of runs so evolutionary
 * experimentation can be inspected across generations.
 *
 * A LineageTree is an in-memory store of run metadata
 * that supports parent/child queries, generation filtering,
 * and serialization to/from JSON.
 */

/**
 * Create a lineage tree.
 * @returns {LineageTree}
 */
export function createLineageTree() {
  // runId → node
  const nodes = new Map();

  return {
    /**
     * Add a run to the lineage tree.
     * @param {Object} entry
     * @param {string} entry.runId
     * @param {string|null} entry.parentRunId
     * @param {number} entry.generation
     * @param {Object} entry.botConfig — serialized bot config
     * @param {Object} entry.summary — run summary stats
     * @param {Object} [entry.reward] — reward breakdown
     */
    addRun(entry) {
      const node = {
        runId: entry.runId,
        parentRunId: entry.parentRunId || null,
        generation: entry.generation || 0,
        botConfig: entry.botConfig,
        summary: entry.summary,
        reward: entry.reward || null,
        children: [],
      };
      nodes.set(entry.runId, node);

      // Link to parent
      if (node.parentRunId && nodes.has(node.parentRunId)) {
        nodes.get(node.parentRunId).children.push(entry.runId);
      }
    },

    /**
     * Get a single lineage node by runId.
     */
    getNode(runId) {
      return nodes.get(runId) || null;
    },

    /**
     * Get direct children of a run.
     */
    getChildren(runId) {
      const node = nodes.get(runId);
      if (!node) return [];
      return node.children.map(id => nodes.get(id)).filter(Boolean);
    },

    /**
     * Get the full ancestry chain from a run back to the root.
     * Returns [root, ..., parent, self].
     */
    getAncestry(runId) {
      const chain = [];
      let current = runId;
      const visited = new Set();
      while (current && !visited.has(current)) {
        visited.add(current);
        const node = nodes.get(current);
        if (!node) break;
        chain.unshift(node);
        current = node.parentRunId;
      }
      return chain;
    },

    /**
     * Get all runs in a specific generation.
     */
    getGeneration(gen) {
      const result = [];
      for (const node of nodes.values()) {
        if (node.generation === gen) result.push(node);
      }
      return result;
    },

    /**
     * Get the maximum generation number in the tree.
     */
    maxGeneration() {
      let max = 0;
      for (const node of nodes.values()) {
        if (node.generation > max) max = node.generation;
      }
      return max;
    },

    /**
     * Get all root nodes (no parent).
     */
    getRoots() {
      const result = [];
      for (const node of nodes.values()) {
        if (!node.parentRunId) result.push(node);
      }
      return result;
    },

    /**
     * Get the best run per generation by score.
     */
    getBestPerGeneration() {
      const byGen = new Map();
      for (const node of nodes.values()) {
        const gen = node.generation;
        const score = node.summary?.score ?? -Infinity;
        if (!byGen.has(gen) || score > byGen.get(gen).summary.score) {
          byGen.set(gen, node);
        }
      }
      return [...byGen.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([gen, node]) => ({ generation: gen, ...node }));
    },

    /**
     * Get the full tree as a flat array of nodes.
     */
    allNodes() {
      return [...nodes.values()];
    },

    /**
     * Total number of runs in the tree.
     */
    size() {
      return nodes.size;
    },

    /**
     * Serialize to a JSON-friendly array.
     */
    serialize() {
      return [...nodes.values()].map(n => ({
        runId: n.runId,
        parentRunId: n.parentRunId,
        generation: n.generation,
        botConfig: n.botConfig,
        summary: n.summary,
        reward: n.reward,
        children: [...n.children],
      }));
    },

    /**
     * Load from a serialized array.
     */
    load(data) {
      nodes.clear();
      for (const entry of data) {
        nodes.set(entry.runId, {
          runId: entry.runId,
          parentRunId: entry.parentRunId || null,
          generation: entry.generation || 0,
          botConfig: entry.botConfig,
          summary: entry.summary,
          reward: entry.reward || null,
          children: entry.children || [],
        });
      }
    },
  };
}
