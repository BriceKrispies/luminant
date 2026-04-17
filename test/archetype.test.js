/**
 * Tests for the player archetype system.
 * Covers: content registry, skills.applyArchetype, decision-driven run-start
 * flow via game-runner.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadEngine } from '../src/engine/loader.js';
import { runGame } from '../src/ai/game-runner.js';
import { ARCHETYPES, DEFAULT_ARCHETYPE_ID, getArchetype } from '../src/content/archetypes.js';
import { makeRequestId } from '../src/decisions/types.js';
import '../src/systems/player-ai/policies/strategist.js';
import { createPolicy } from '../src/ai/policy-types.js';

let wasm;
beforeAll(async () => { wasm = await loadEngine(); });

describe('archetype content', () => {
  it('defines at least two archetypes with required fields', () => {
    expect(ARCHETYPES.length).toBeGreaterThanOrEqual(2);
    for (const a of ARCHETYPES) {
      expect(a.id).toBeTruthy();
      expect(a.name).toBeTruthy();
      expect(a.desc).toBeTruthy();
    }
  });

  it('default archetype exists in registry', () => {
    expect(getArchetype(DEFAULT_ARCHETYPE_ID)).not.toBeNull();
  });

  it('getArchetype returns null for unknown id', () => {
    expect(getArchetype('nonexistent-id')).toBeNull();
  });
});

describe('archetype flow via game-runner', () => {
  it('records an archetype decision before upgrades in decisionHistory', async () => {
    const policy = createPolicy('strategist');
    const result = await runGame({
      policy, seed: 12345, maxTicks: 1500, wasm,
    });

    expect(Array.isArray(result.decisionHistory)).toBe(true);
    expect(result.decisionHistory.length).toBeGreaterThan(0);

    const first = result.decisionHistory[0];
    expect(first.kind).toBe('archetype');
    expect(first.tick).toBe(-1);  // pre-loop marker
    expect(first.requestId).toMatch(/^archetype:12345:-1:0$/);
    // All archetype ids must be valid
    expect(ARCHETYPES.some(a => a.id === first.choiceId)).toBe(true);
  });

  it('scripted replay honors recorded archetype choice', async () => {
    const policy = createPolicy('strategist');
    // Force the 'ranger' archetype via a prebuilt script
    const script = [{
      requestId: makeRequestId('archetype', 11, -1, 0),
      kind: 'archetype',
      tick: -1,
      choiceId: 'ranger',
      optionIds: ARCHETYPES.map(a => a.id),
      source: 'policy',
    }];

    const result = await runGame({
      policy, seed: 11, maxTicks: 500, wasm,
      decisionScript: script,
    });

    const archDecision = result.decisionHistory.find(d => d.kind === 'archetype');
    expect(archDecision.choiceId).toBe('ranger');
    expect(archDecision.source).toBe('scripted');
  });

  it('deterministic archetype choice under same seed', async () => {
    const policy = createPolicy('strategist');
    const a = await runGame({ policy, seed: 5555, maxTicks: 300, wasm });
    const b = await runGame({ policy: createPolicy('strategist'), seed: 5555, maxTicks: 300, wasm });
    const archA = a.decisionHistory.find(d => d.kind === 'archetype');
    const archB = b.decisionHistory.find(d => d.kind === 'archetype');
    expect(archA.choiceId).toBe(archB.choiceId);
  });
});
