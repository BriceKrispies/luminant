/**
 * Tests for the decision system.
 * Covers: types, manager modes (policy/live/scripted), id determinism,
 * lazy options, drift detection, cancellation, default-choice fallback.
 */

import { describe, it, expect } from 'vitest';
import { createDecisionManager } from '../src/decisions/manager.js';
import {
  DecisionKind, DecisionSource, DecisionMode, makeRequestId,
} from '../src/decisions/types.js';

const UPGRADE_CHOICES = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Gamma' },
];

function makeUpgradeReq(tick, options = UPGRADE_CHOICES) {
  return {
    kind: DecisionKind.UPGRADE,
    tick,
    optionsFn: () => options,
    defaultChoiceId: options[0].id,
    context: { level: tick },
  };
}

function policyReturning(upgradeId) {
  return {
    id: 'stub', name: 'stub',
    decide(req) {
      return upgradeId;
    },
  };
}

describe('types', () => {
  it('makeRequestId is deterministic', () => {
    expect(makeRequestId('upgrade', 42, 100, 0)).toBe('upgrade:42:100:0');
    expect(makeRequestId('archetype', 1, 0, 0)).toBe('archetype:1:0:0');
  });
});

describe('manager: policy mode', () => {
  it('resolves synchronously via policy.decide', () => {
    const history = [];
    const mgr = createDecisionManager({
      mode: DecisionMode.POLICY,
      policy: policyReturning('b'),
      seed: 7, history,
    });
    const result = mgr.requestSync(makeUpgradeReq(100));
    expect(result.choiceId).toBe('b');
    expect(result.source).toBe(DecisionSource.POLICY);
    expect(result.requestId).toBe('upgrade:7:100:0');
    expect(result.optionIds).toEqual(['a', 'b', 'c']);
    expect(history).toHaveLength(1);
  });

  it('falls back to chooseUpgrade compat shim', () => {
    const policy = {
      id: 'p', name: 'p',
      chooseUpgrade: (choices) => choices[2].id,
    };
    const mgr = createDecisionManager({
      mode: DecisionMode.POLICY, policy, seed: 1,
    });
    const result = mgr.requestSync(makeUpgradeReq(0));
    expect(result.choiceId).toBe('c');
    expect(result.source).toBe(DecisionSource.POLICY);
  });

  it('uses defaultChoiceId when policy is missing', () => {
    const mgr = createDecisionManager({ mode: DecisionMode.POLICY, seed: 1 });
    const result = mgr.requestSync(makeUpgradeReq(0));
    expect(result.choiceId).toBe('a');
    expect(result.source).toBe(DecisionSource.DEFAULT);
  });

  it('uses defaultChoiceId when policy returns invalid id', () => {
    const mgr = createDecisionManager({
      mode: DecisionMode.POLICY,
      policy: policyReturning('not-a-real-id'),
      seed: 1,
    });
    const result = mgr.requestSync(makeUpgradeReq(0));
    expect(result.choiceId).toBe('a');
    expect(result.source).toBe(DecisionSource.DEFAULT);
  });

  it('request() resolves synchronously in policy mode', () => {
    const mgr = createDecisionManager({
      mode: DecisionMode.POLICY, policy: policyReturning('c'), seed: 1,
    });
    let captured = null;
    const result = mgr.request(makeUpgradeReq(0), (r) => { captured = r; });
    expect(result.choiceId).toBe('c');
    expect(captured).not.toBeNull();
    expect(captured.choiceId).toBe('c');
  });
});

describe('manager: id determinism', () => {
  it('increments counter within the same tick', () => {
    const mgr = createDecisionManager({
      mode: DecisionMode.POLICY, policy: policyReturning('a'), seed: 42,
    });
    const r0 = mgr.requestSync(makeUpgradeReq(50));
    const r1 = mgr.requestSync(makeUpgradeReq(50));
    const r2 = mgr.requestSync(makeUpgradeReq(51));
    expect(r0.requestId).toBe('upgrade:42:50:0');
    expect(r1.requestId).toBe('upgrade:42:50:1');
    expect(r2.requestId).toBe('upgrade:42:51:0');
  });
});

describe('manager: lazy options', () => {
  it('does not call optionsFn until resolution time', () => {
    let calls = 0;
    const req = {
      kind: DecisionKind.UPGRADE, tick: 0,
      optionsFn: () => { calls++; return UPGRADE_CHOICES; },
      defaultChoiceId: 'a',
    };
    const mgr = createDecisionManager({
      mode: DecisionMode.POLICY, policy: policyReturning('a'), seed: 1,
    });
    expect(calls).toBe(0);
    mgr.requestSync(req);
    expect(calls).toBe(1);
  });

  it('re-rolls options per decision when function returns different arrays', () => {
    // This mirrors the same-tick double level-up bug: options should be
    // computed at resolution time, not at request creation.
    let round = 0;
    const mgr = createDecisionManager({
      mode: DecisionMode.POLICY,
      policy: { id: 'p', name: 'p', decide: (req) => req.options[0].id },
      seed: 1,
    });
    const req1 = {
      kind: DecisionKind.UPGRADE, tick: 0,
      optionsFn: () => (round++ === 0 ? [{id: 'x'}] : [{id: 'y'}]),
      defaultChoiceId: 'x',
    };
    const req2 = {
      kind: DecisionKind.UPGRADE, tick: 0,
      optionsFn: () => (round++ === 1 ? [{id: 'y'}] : [{id: 'z'}]),
      defaultChoiceId: 'z',
    };
    const r1 = mgr.requestSync(req1);
    const r2 = mgr.requestSync(req2);
    expect(r1.choiceId).toBe('x');
    expect(r2.choiceId).toBe('y');
  });
});

describe('manager: scripted mode', () => {
  it('replays a recorded choice when id and option match', () => {
    const script = [{
      requestId: 'upgrade:9:5:0', kind: 'upgrade', tick: 5,
      choiceId: 'b', optionIds: ['a','b','c'], source: 'policy',
    }];
    const mgr = createDecisionManager({
      mode: DecisionMode.SCRIPTED,
      script, policy: policyReturning('c'), seed: 9,
    });
    const result = mgr.requestSync(makeUpgradeReq(5));
    expect(result.choiceId).toBe('b');
    expect(result.source).toBe(DecisionSource.SCRIPTED);
  });

  it('logs drift and falls back to policy when id mismatches', () => {
    const script = [{
      requestId: 'upgrade:9:4:0', kind: 'upgrade', tick: 4,
      choiceId: 'b', optionIds: ['a','b','c'], source: 'policy',
    }];
    const drifts = [];
    const mgr = createDecisionManager({
      mode: DecisionMode.SCRIPTED,
      script, policy: policyReturning('c'), seed: 9,
      onDrift: (req, recorded, reason) => drifts.push(reason),
    });
    const result = mgr.requestSync(makeUpgradeReq(5));
    expect(result.source).toBe(DecisionSource.POLICY);
    expect(result.choiceId).toBe('c');
    expect(drifts).toContain('id-mismatch');
  });

  it('falls through when recorded choice not in current options', () => {
    const script = [{
      requestId: 'upgrade:9:5:0', kind: 'upgrade', tick: 5,
      choiceId: 'zzz', optionIds: ['a','b','c'], source: 'policy',
    }];
    const drifts = [];
    const mgr = createDecisionManager({
      mode: DecisionMode.SCRIPTED,
      script, policy: policyReturning('a'), seed: 9,
      onDrift: (req, recorded, reason) => drifts.push(reason),
    });
    const result = mgr.requestSync(makeUpgradeReq(5));
    expect(result.choiceId).toBe('a');
    expect(drifts).toContain('choice-unavailable');
  });
});

describe('manager: live mode', () => {
  function makePresenter() {
    const calls = [];
    let lastResolve = null;
    return {
      calls,
      get lastResolve() { return lastResolve; },
      present(req, options, resolve) {
        calls.push({ req, options });
        lastResolve = resolve;
      },
      cancel() { lastResolve = null; },
    };
  }

  it('defers to presenter and resolves via human callback', () => {
    const presenter = makePresenter();
    const mgr = createDecisionManager({
      mode: DecisionMode.LIVE, presenter,
      policy: policyReturning('a'), seed: 1,
    });
    let resolved = null;
    const syncReturn = mgr.request(makeUpgradeReq(10), (r) => { resolved = r; });
    expect(syncReturn).toBeNull();
    expect(presenter.calls).toHaveLength(1);
    expect(resolved).toBeNull();

    presenter.lastResolve('c');
    expect(resolved).not.toBeNull();
    expect(resolved.choiceId).toBe('c');
    expect(resolved.source).toBe(DecisionSource.HUMAN);
  });

  it('falls through to policy on deadline timeout', () => {
    const presenter = makePresenter();
    const mgr = createDecisionManager({
      mode: DecisionMode.LIVE, presenter,
      policy: policyReturning('b'), seed: 1,
    });
    let resolved = null;
    mgr.request(
      { ...makeUpgradeReq(0), deadlineMs: 1000 },
      (r) => { resolved = r; },
    );
    expect(resolved).toBeNull();
    mgr.tick(0.5);  // 500ms
    expect(resolved).toBeNull();
    mgr.tick(0.6);  // 1100ms cumulative — past deadline
    expect(resolved).not.toBeNull();
    expect(resolved.choiceId).toBe('b');
    expect(resolved.source).toBe(DecisionSource.POLICY);
  });

  it('processes queue in FIFO order', () => {
    const presenter = makePresenter();
    const mgr = createDecisionManager({
      mode: DecisionMode.LIVE, presenter,
      policy: policyReturning('a'), seed: 1,
    });
    const order = [];
    mgr.request(makeUpgradeReq(1), (r) => order.push(r.requestId));
    mgr.request(makeUpgradeReq(2), (r) => order.push(r.requestId));
    expect(presenter.calls).toHaveLength(1);  // only first active
    expect(mgr.pending).toBe(2);

    presenter.lastResolve('a');
    expect(presenter.calls).toHaveLength(2);  // second presented
    presenter.lastResolve('b');
    expect(order[0]).toContain('upgrade:1:1:0');
    expect(order[1]).toContain('upgrade:1:2:0');
  });

  it('cancelAll drops queued decisions', () => {
    const presenter = makePresenter();
    const mgr = createDecisionManager({
      mode: DecisionMode.LIVE, presenter,
      policy: policyReturning('a'), seed: 1,
    });
    let resolved1 = null;
    let resolved2 = null;
    mgr.request(makeUpgradeReq(1), (r) => { resolved1 = r; });
    mgr.request(makeUpgradeReq(2), (r) => { resolved2 = r; });
    mgr.cancelAll();
    expect(mgr.pending).toBe(0);
    expect(resolved1).toBeNull();
    expect(resolved2).toBeNull();
  });

  it('blocking reflects active request', () => {
    const presenter = makePresenter();
    const mgr = createDecisionManager({
      mode: DecisionMode.LIVE, presenter,
      policy: policyReturning('a'), seed: 1,
    });
    expect(mgr.blocking).toBe(false);
    mgr.request({ ...makeUpgradeReq(0), blocking: true }, () => {});
    expect(mgr.blocking).toBe(true);
    presenter.lastResolve('a');
    expect(mgr.blocking).toBe(false);
  });

  it('falls through immediately when no presenter is injected', () => {
    const mgr = createDecisionManager({
      mode: DecisionMode.LIVE, policy: policyReturning('c'), seed: 1,
    });
    let resolved = null;
    mgr.request(makeUpgradeReq(0), (r) => { resolved = r; });
    expect(resolved).not.toBeNull();
    expect(resolved.choiceId).toBe('c');
  });
});

describe('manager: history sink', () => {
  it('appends every resolved decision to injected history array', () => {
    const history = [];
    const mgr = createDecisionManager({
      mode: DecisionMode.POLICY, policy: policyReturning('a'),
      seed: 1, history,
    });
    mgr.requestSync(makeUpgradeReq(0));
    mgr.requestSync(makeUpgradeReq(1));
    expect(history).toHaveLength(2);
    expect(history[0].tick).toBe(0);
    expect(history[1].tick).toBe(1);
  });
});
