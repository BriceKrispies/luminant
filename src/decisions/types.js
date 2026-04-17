/**
 * Decision system — pure data types.
 *
 * Headless-safe: no DOM, canvas, engine, or renderer imports.
 * Used by gameplay systems to request a decision (archetype, upgrade, shop…)
 * without knowing whether it will be resolved by a UI, a policy, or a replay.
 */

/**
 * Known decision kinds. Kind strings are free-form; this enum is for readability.
 */
export const DecisionKind = {
  ARCHETYPE: 'archetype',
  UPGRADE: 'upgrade',
};

/**
 * Source of a resolved decision. Recorded for auditing replay/analytics.
 */
export const DecisionSource = {
  HUMAN: 'human',
  POLICY: 'policy',
  DEFAULT: 'default',
  SCRIPTED: 'scripted',
};

/**
 * Manager operating modes.
 *   'policy'   — synchronous, resolves via policy (headless harness path).
 *   'live'     — async, uses presenter; falls back to policy on timeout.
 *   'scripted' — synchronous, replays from a recorded decisionHistory.
 */
export const DecisionMode = {
  POLICY: 'policy',
  LIVE: 'live',
  SCRIPTED: 'scripted',
};

/**
 * @typedef {Object} DecisionChoice
 * @property {string} id             — stable identifier for this option
 * @property {string} [label]        — human-readable (UI only; resolver ignores)
 * @property {Object} [data]         — payload applied on resolution
 * @property {Object} [meta]         — tier/rarity/desc (UI only)
 */

/**
 * @typedef {Object} DecisionRequest
 * @property {string} kind                — 'archetype' | 'upgrade' | ...
 * @property {number} tick                — current sim tick (used for id)
 * @property {function(): DecisionChoice[]} optionsFn
 *   LAZY — invoked by the manager at resolution time, not at request creation.
 *   Fixes the "same-tick double level-up options frozen before first apply" bug.
 * @property {Object} [context]           — arbitrary data for the resolver
 * @property {string} defaultChoiceId     — must always be a valid option.id (fallback)
 * @property {boolean} [blocking=false]   — true halts main-loop simulation
 * @property {number}  [deadlineMs]       — live-mode only (ms until auto-pick)
 */

/**
 * @typedef {Object} DecisionResult
 * @property {string} requestId   — `${kind}:${seed}:${tick}:${counter}`
 * @property {string} kind
 * @property {number} tick
 * @property {string} choiceId
 * @property {string[]} optionIds — ids offered at resolution time (for drift check)
 * @property {string} source      — DecisionSource
 */

/**
 * Build a deterministic request id.
 */
export function makeRequestId(kind, seed, tick, counter) {
  return `${kind}:${seed}:${tick}:${counter}`;
}
