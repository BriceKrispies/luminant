/**
 * Policy interface definition and registry.
 *
 * A policy controls the player by receiving observations each tick
 * and emitting actions that map directly into the input pathway.
 *
 * All policies must implement:
 *   reset()          — called at start of each run
 *   act(observation)  — returns an action object each tick
 *   chooseUpgrade(choices, observation) — pick an upgrade on level-up
 *
 * Optional:
 *   name             — human-readable name
 *   id               — machine identifier
 *   params           — tunable parameter object
 *   metadata()       — returns info for reporting
 */

/**
 * @typedef {Object} PolicyAction
 * @property {number} dx — movement X (-1 to 1)
 * @property {number} dy — movement Y (-1 to 1)
 * @property {boolean} attack — whether to attack this tick
 * @property {number} targetX — world-space aim X
 * @property {number} targetY — world-space aim Y
 */

/**
 * @typedef {Object} PolicyInterface
 * @property {string} name
 * @property {string} id
 * @property {Object} params — tunable parameters
 * @property {function} reset — reset internal state for new run
 * @property {function(Observation): PolicyAction} act
 * @property {function(Array, Observation): string} chooseUpgrade — returns upgrade id
 * @property {function(): Object} [metadata] — optional reporting info
 */

/** Registry of known policy factories */
const POLICY_REGISTRY = new Map();

/**
 * Register a policy factory.
 * @param {string} id — unique identifier
 * @param {function(Object): PolicyInterface} factory — creates policy from params
 */
export function registerPolicy(id, factory) {
  POLICY_REGISTRY.set(id, factory);
}

/**
 * Create a policy instance by id.
 * @param {string} id
 * @param {Object} [params] — override default parameters
 * @returns {PolicyInterface}
 */
export function createPolicy(id, params = {}) {
  const factory = POLICY_REGISTRY.get(id);
  if (!factory) throw new Error(`Unknown policy: "${id}". Known: ${[...POLICY_REGISTRY.keys()].join(', ')}`);
  return factory(params);
}

/** List all registered policy IDs */
export function listPolicies() {
  return [...POLICY_REGISTRY.keys()];
}

/** Get default params for a policy (creates a temporary instance) */
export function getDefaultParams(id) {
  const policy = createPolicy(id);
  return { ...policy.params };
}

/**
 * Validate that an object implements the policy interface.
 * Throws if it doesn't.
 */
export function validatePolicy(policy) {
  if (typeof policy.reset !== 'function') throw new Error('Policy missing reset()');
  if (typeof policy.act !== 'function') throw new Error('Policy missing act()');
  if (typeof policy.chooseUpgrade !== 'function') throw new Error('Policy missing chooseUpgrade()');
  if (typeof policy.name !== 'string') throw new Error('Policy missing name');
  if (typeof policy.id !== 'string') throw new Error('Policy missing id');
  return true;
}
