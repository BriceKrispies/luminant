/**
 * Integration test: scripted-mode replay through the game-runner.
 * Confirms that a recorded decisionHistory deterministically replays
 * upgrade choices even if the underlying policy would have picked
 * differently (drift fallback is audited but not triggered here).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadEngine } from '../src/engine/loader.js';
import { runGame } from '../src/ai/game-runner.js';

// Register a policy so createPolicy works
import '../src/systems/player-ai/policies/strategist.js';
import { createPolicy } from '../src/ai/policy-types.js';

let wasm;
beforeAll(async () => { wasm = await loadEngine(); });

function makePolicy() {
  return createPolicy('strategist');
}

describe('scripted replay via game-runner', () => {
  it('records decisionHistory on normal run', async () => {
    const result = await runGame({
      policy: makePolicy(),
      seed: 4242,
      maxTicks: 4000,
      wasm,
    });
    expect(Array.isArray(result.decisionHistory)).toBe(true);
    const upgradeEntry = result.decisionHistory.find(d => d.kind === 'upgrade');
    if (upgradeEntry) {
      expect(upgradeEntry).toHaveProperty('requestId');
      expect(upgradeEntry).toHaveProperty('choiceId');
      expect(upgradeEntry).toHaveProperty('optionIds');
      expect(upgradeEntry).toHaveProperty('source');
      // Request id is deterministic from seed
      expect(upgradeEntry.requestId).toMatch(/^upgrade:4242:\d+:\d+$/);
    }
  });

  it('replaying with recorded script produces matching upgrade path', async () => {
    const original = await runGame({
      policy: makePolicy(),
      seed: 9999,
      maxTicks: 4000,
      wasm,
    });
    expect(original.decisionHistory.length).toBeGreaterThan(0);

    const replay = await runGame({
      policy: makePolicy(),
      seed: 9999,
      maxTicks: 4000,
      wasm,
      decisionScript: original.decisionHistory,
    });

    expect(replay.upgradePath).toEqual(original.upgradePath);
    // Scripted source should dominate for entries that matched
    const scriptedCount = replay.decisionHistory.filter(d => d.source === 'scripted').length;
    expect(scriptedCount).toBeGreaterThan(0);
  });

  it('drift fallback: mutated upgrade script falls through to policy', async () => {
    const original = await runGame({
      policy: makePolicy(),
      seed: 7777,
      maxTicks: 3000,
      wasm,
    });
    const firstUpgradeIdx = original.decisionHistory.findIndex(d => d.kind === 'upgrade');
    if (firstUpgradeIdx < 0) return;  // skip if no level-ups occurred

    // Corrupt: mutate the first upgrade entry's requestId so drift is triggered
    const mutated = original.decisionHistory.map((d, i) =>
      i === firstUpgradeIdx ? { ...d, requestId: 'upgrade:0:0:0' } : d,
    );

    let drifts = 0;
    const replay = await runGame({
      policy: makePolicy(),
      seed: 7777,
      maxTicks: 3000,
      wasm,
      decisionScript: mutated,
      onDecisionDrift: () => { drifts++; },
    });

    expect(drifts).toBeGreaterThan(0);
    // Corrupted upgrade entry falls through to the policy's chooseUpgrade.
    const replayedFirstUpgrade = replay.decisionHistory.find(d => d.kind === 'upgrade');
    expect(replayedFirstUpgrade.source).toBe('policy');
  });
});
