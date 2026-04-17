/**
 * Decision manager.
 *
 * Single entry point for gameplay decision requests. Dispatches to one of
 * three modes depending on context:
 *
 *   'policy'   — synchronous; calls policy.decide() (or .chooseUpgrade compat
 *                shim). Used by headless harness / training.
 *   'live'     — async; defers to a UI presenter with a timeout fallback to
 *                policy. Used by the browser game.
 *   'scripted' — synchronous; replays from a recorded decisionHistory. Used
 *                by the simulation lab replay path.
 *
 * Headless-safe: no imports from src/engine, src/renderer, src/ui.
 * The presenter is injected in live mode — the manager never imports DOM.
 */

import { DecisionMode, DecisionSource, makeRequestId } from './types.js';

/**
 * @param {Object} options
 * @param {string} options.mode              — DecisionMode
 * @param {Object} [options.policy]          — live policy (requires .decide or .chooseUpgrade)
 * @param {Object} [options.presenter]       — live-mode UI adapter
 *   { present(req, options, resolve), cancel() }
 * @param {number} [options.seed=0]          — seed, used only for request ids
 * @param {Array}  [options.history]         — array to append resolved decisions to
 * @param {Array}  [options.script]          — scripted-mode: prior decision log to replay
 * @param {function} [options.onDrift]       — scripted-mode: (req, recorded, reason) => void
 * @param {function} [options.onObservation] — returns the latest observation for policy calls
 */
export function createDecisionManager(options) {
  const {
    mode,
    policy = null,
    presenter = null,
    seed = 0,
    history = [],
    script = [],
    onDrift = null,
    onObservation = () => null,
  } = options;

  if (!Object.values(DecisionMode).includes(mode)) {
    throw new Error(`Unknown decision mode: ${mode}`);
  }
  if (mode === DecisionMode.LIVE && !presenter) {
    // Live mode without a presenter is legal — it simply falls through to
    // policy resolution. We still warn because it indicates a wiring bug.
    // eslint-disable-next-line no-console
    console.warn('[decisions] live mode constructed without a presenter; all requests will fall through to policy.');
  }

  // Per-tick counter so same-tick decisions get unique ids.
  let lastTickForCounter = -1;
  let counterWithinTick = 0;

  // Scripted mode reads sequentially from the recorded history.
  let scriptIndex = 0;

  // Live mode queue (FIFO). Each entry: { req, options, onResolved, deadlineAt, active }
  const queue = [];
  let activeEntry = null;
  let livePresenterBusy = false;

  /** One drift warning per mismatch class, to avoid log spam. */
  const driftSeen = new Set();

  function nextRequestId(req) {
    if (req.tick !== lastTickForCounter) {
      lastTickForCounter = req.tick;
      counterWithinTick = 0;
    }
    const id = makeRequestId(req.kind, seed, req.tick, counterWithinTick);
    counterWithinTick++;
    return id;
  }

  function freezeOptions(req) {
    if (typeof req.optionsFn !== 'function') {
      throw new Error(`DecisionRequest missing optionsFn (kind=${req.kind})`);
    }
    const options = req.optionsFn();
    if (!Array.isArray(options) || options.length === 0) {
      throw new Error(`DecisionRequest optionsFn returned no choices (kind=${req.kind})`);
    }
    return options;
  }

  function recordResult(result) {
    history.push(result);
    return result;
  }

  /**
   * Pick via policy. Tries `policy.decide(req, obs)` first, falls back to
   * `policy.chooseUpgrade(choices, obs)` for upgrade kind, else defaultChoiceId.
   */
  function resolveViaPolicy(req, options, requestId) {
    const obs = onObservation();
    const choiceIds = options.map(o => o.id);

    let chosenId = null;

    if (policy && typeof policy.decide === 'function') {
      chosenId = policy.decide({ ...req, options }, obs);
    } else if (policy && req.kind === 'upgrade' && typeof policy.chooseUpgrade === 'function') {
      chosenId = policy.chooseUpgrade(options, obs);
    }

    if (!chosenId || !choiceIds.includes(chosenId)) {
      // Policy declined or returned something invalid — fall back to default.
      return {
        requestId,
        kind: req.kind,
        tick: req.tick,
        choiceId: ensureValidDefault(req.defaultChoiceId, choiceIds, options),
        optionIds: choiceIds,
        source: DecisionSource.DEFAULT,
      };
    }

    return {
      requestId,
      kind: req.kind,
      tick: req.tick,
      choiceId: chosenId,
      optionIds: choiceIds,
      source: DecisionSource.POLICY,
    };
  }

  function ensureValidDefault(defaultId, choiceIds, options) {
    if (defaultId && choiceIds.includes(defaultId)) return defaultId;
    return options[0].id;
  }

  /**
   * Scripted resolution — pops next entry from the recorded script.
   * Drift detection: requestId, kind, and offered optionIds must match.
   * On mismatch, logs once and falls through to policy.
   */
  function resolveViaScript(req, options, requestId) {
    const choiceIds = options.map(o => o.id);

    // Find the next script entry matching this request's kind.
    // (Simple sequential walk; scripts are small.)
    while (scriptIndex < script.length) {
      const entry = script[scriptIndex];
      if (entry.kind !== req.kind) {
        scriptIndex++;
        continue;
      }
      scriptIndex++;

      const idMatch = entry.requestId === requestId;
      const choiceAvailable = choiceIds.includes(entry.choiceId);

      if (idMatch && choiceAvailable) {
        return {
          requestId,
          kind: req.kind,
          tick: req.tick,
          choiceId: entry.choiceId,
          optionIds: choiceIds,
          source: DecisionSource.SCRIPTED,
        };
      }

      // Drift — log once per (requestId, reason) class, then fall through.
      const reason = !idMatch ? 'id-mismatch'
        : !choiceAvailable ? 'choice-unavailable'
        : 'unknown';
      const key = `${req.kind}:${reason}`;
      if (!driftSeen.has(key)) {
        driftSeen.add(key);
        if (onDrift) onDrift(req, entry, reason);
        // eslint-disable-next-line no-console
        console.warn(`[decisions] scripted drift (${reason}) kind=${req.kind} recorded=${entry.requestId} actual=${requestId}`);
      }
      break;
    }

    // No matching script entry or drift occurred — fall through to policy.
    return resolveViaPolicy(req, options, requestId);
  }

  /**
   * Synchronous resolution path — used by policy and scripted modes.
   * Live mode must use `request()` instead.
   */
  function requestSync(req) {
    const requestId = nextRequestId(req);
    const options = freezeOptions(req);

    let result;
    if (mode === DecisionMode.SCRIPTED) {
      result = resolveViaScript(req, options, requestId);
    } else {
      result = resolveViaPolicy(req, options, requestId);
    }
    return recordResult(result);
  }

  /**
   * Async / deferred resolution — used by live mode.
   * `onResolved(result)` is invoked when the decision resolves (presenter
   * click, deadline, or cancellation).
   *
   * In policy/scripted modes, resolves synchronously before returning.
   */
  function request(req, onResolved) {
    if (mode !== DecisionMode.LIVE) {
      const result = requestSync(req);
      if (onResolved) onResolved(result);
      return result;
    }

    const requestId = nextRequestId(req);
    // Freeze options lazily — at presentation time, not enqueue time.
    const entry = {
      req,
      requestId,
      onResolved: onResolved || (() => {}),
      deadlineRemainingMs: typeof req.deadlineMs === 'number' ? req.deadlineMs : 5000,
      options: null,
      active: false,
      cancelled: false,
    };
    queue.push(entry);
    if (!activeEntry) advanceQueue();
    return null;
  }

  function advanceQueue() {
    if (activeEntry) return;
    while (queue.length > 0) {
      const next = queue.shift();
      if (next.cancelled) continue;
      activeEntry = next;
      presentActive();
      return;
    }
  }

  function presentActive() {
    const entry = activeEntry;
    if (!entry) return;

    // Freeze options at presentation time so stats applied by earlier
    // decisions in the queue are reflected in this one's choices.
    entry.options = freezeOptions(entry.req);
    entry.active = true;

    const resolveCallback = (choiceId) => resolveLive(entry, choiceId, DecisionSource.HUMAN);

    if (presenter && typeof presenter.present === 'function') {
      livePresenterBusy = true;
      try {
        presenter.present(entry.req, entry.options, resolveCallback);
      } catch (err) {
        // Presenter failure → fall through to policy so the game doesn't hang.
        // eslint-disable-next-line no-console
        console.error('[decisions] presenter.present threw; falling through to policy', err);
        resolveLive(entry, null, DecisionSource.POLICY);
      }
    } else {
      // No presenter — fall through immediately to policy.
      resolveLive(entry, null, DecisionSource.POLICY);
    }
  }

  /**
   * Completes the active live decision. `choiceIdOrNull === null` means the
   * human didn't pick — resolve via policy/default.
   */
  function resolveLive(entry, choiceIdOrNull, claimedSource) {
    if (!entry || entry !== activeEntry) return;  // stale
    if (entry.cancelled) return;

    const choiceIds = entry.options.map(o => o.id);
    let result;

    if (choiceIdOrNull && choiceIds.includes(choiceIdOrNull)) {
      result = {
        requestId: entry.requestId,
        kind: entry.req.kind,
        tick: entry.req.tick,
        choiceId: choiceIdOrNull,
        optionIds: choiceIds,
        source: claimedSource,
      };
    } else {
      // Fall through to policy / default — reuse the sync path but reusing
      // the already-frozen options + pre-assigned id.
      const obs = onObservation();
      let chosen = null;
      if (policy && typeof policy.decide === 'function') {
        chosen = policy.decide({ ...entry.req, options: entry.options }, obs);
      } else if (policy && entry.req.kind === 'upgrade' && typeof policy.chooseUpgrade === 'function') {
        chosen = policy.chooseUpgrade(entry.options, obs);
      }
      const valid = chosen && choiceIds.includes(chosen);
      result = {
        requestId: entry.requestId,
        kind: entry.req.kind,
        tick: entry.req.tick,
        choiceId: valid ? chosen : ensureValidDefault(entry.req.defaultChoiceId, choiceIds, entry.options),
        optionIds: choiceIds,
        source: valid ? DecisionSource.POLICY : DecisionSource.DEFAULT,
      };
    }

    recordResult(result);
    try {
      entry.onResolved(result);
    } finally {
      activeEntry = null;
      livePresenterBusy = false;
      advanceQueue();
    }
  }

  /** Live-mode timer advance. Called once per main-loop frame. */
  function tick(dtSeconds) {
    if (mode !== DecisionMode.LIVE) return;
    if (!activeEntry || !activeEntry.active) return;
    activeEntry.deadlineRemainingMs -= dtSeconds * 1000;
    if (activeEntry.deadlineRemainingMs <= 0) {
      // Timeout — fall through to policy.
      resolveLive(activeEntry, null, DecisionSource.POLICY);
    }
  }

  /** Drop everything. Called on game-over / restart. */
  function cancelAll() {
    for (const entry of queue) entry.cancelled = true;
    queue.length = 0;
    if (activeEntry) {
      activeEntry.cancelled = true;
      if (presenter && typeof presenter.cancel === 'function') {
        try { presenter.cancel(); } catch (_) { /* ignore */ }
      }
      activeEntry = null;
      livePresenterBusy = false;
    }
  }

  return {
    mode,
    request,
    requestSync,
    tick,
    cancelAll,

    /** True if a blocking decision is currently active; main loop should skip sim. */
    get blocking() {
      if (!activeEntry) return false;
      return activeEntry.req.blocking === true;
    },

    get pending() {
      return queue.length + (activeEntry ? 1 : 0);
    },

    get history() {
      return history;
    },

    /** Primarily for tests. */
    _internals() {
      return { queue, activeEntry, scriptIndex, livePresenterBusy };
    },
  };
}
