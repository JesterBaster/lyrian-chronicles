const SYSTEM_ID = "lyrian-chronicles";
const SOCKET_NAMESPACE = `system.${SYSTEM_ID}`;
const PROTOCOL = 1;
const DEFAULT_REQUEST_TIMEOUT = 10_000;
const DEFAULT_LEASE_DURATION = 15_000;
const HEARTBEAT_INTERVAL = 5_000;

const pendingActions = new WeakSet();
const transactionTails = new WeakMap();
const pendingLockRequests = new Map();

let requestCounter = 0;
let runtime = null;

/** Pick one active GM deterministically so every client uses the same authority. */
export function selectActionAuthority(users) {
  return Array.from(users ?? [])
    .filter((user) => user?.active && user?.isGM)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0] ?? null;
}

/**
 * Pure GM-side lock registry used by the socket handler and unit tests.
 * A token prevents a stale release from unlocking a newer action.
 */
export class ActorActionLockRegistry {
  #locks = new Map();
  #counter = 0;
  #now;
  #leaseDuration;

  constructor({ now = () => Date.now(), leaseDuration = DEFAULT_LEASE_DURATION } = {}) {
    this.#now = now;
    this.#leaseDuration = leaseDuration;
  }

  acquire(actorUuid, requestId, userId) {
    if (!actorUuid || !requestId || !userId) return { granted: false, reason: "invalid" };
    const existing = this.#locks.get(actorUuid);
    if (existing && existing.expiresAt > this.#now()) return { granted: false, reason: "busy" };
    if (existing) this.#locks.delete(actorUuid);

    const token = `${requestId}:${++this.#counter}`;
    this.#locks.set(actorUuid, {
      requestId,
      userId,
      token,
      expiresAt: this.#now() + this.#leaseDuration
    });
    return { granted: true, token };
  }

  renew(actorUuid, requestId, userId, token) {
    const lock = this.#locks.get(actorUuid);
    if (!lock || lock.expiresAt <= this.#now()) {
      if (lock) this.#locks.delete(actorUuid);
      return false;
    }
    if (lock.requestId !== requestId || lock.userId !== userId || lock.token !== token) return false;
    lock.expiresAt = this.#now() + this.#leaseDuration;
    return true;
  }

  release(actorUuid, requestId, userId, token) {
    const lock = this.#locks.get(actorUuid);
    if (!lock) return false;
    if (lock.requestId !== requestId || lock.userId !== userId || lock.token !== token) return false;
    this.#locks.delete(actorUuid);
    return true;
  }

  clear() {
    this.#locks.clear();
  }
}

const registry = new ActorActionLockRegistry();

export function actionLockWarningKey(reason) {
  if (reason === "stale") return "LYRIAN.Warn.ActionStateChanged";
  return ["no-authority", "timeout"].includes(reason)
    ? "LYRIAN.Warn.NoActionAuthority"
    : "LYRIAN.Warn.ActionInProgress";
}

/** Snapshot the mutable state that can change the outcome or cost of an action. */
export function actorActionFingerprint(actor) {
  if (!actor) return "";
  const system = actor.system ?? {};
  const resources = Object.fromEntries(["ap", "rp", "mana", "hp"].map((key) => [
    key,
    {
      value: Number(system[key]?.value ?? 0),
      temp: Number(system[key]?.temp ?? 0)
    }
  ]));
  const itemLocks = Array.from(actor.items ?? [])
    .filter((item) => ["ability", "monsterAbility"].includes(item.type))
    .map((item) => [item.id, Boolean(item.system?.usedThisRound)])
    .sort(([a], [b]) => String(a).localeCompare(String(b)));
  const resolvedAttacks = actor.getFlag?.(SYSTEM_ID, "resolvedAttacks")
    ?? actor.flags?.[SYSTEM_ID]?.resolvedAttacks
    ?? {};
  const resolvedCards = Object.entries(resolvedAttacks)
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([id, value]) => [id, value?.defence ?? "", Number(value?.at ?? 0)]);

  return JSON.stringify({
    resources,
    encounter: {
      secretArtUsed: Boolean(system.encounter?.secretArtUsed)
    },
    itemLocks,
    resolvedCards
  });
}

function nextRequestId(userId) {
  requestCounter += 1;
  return `${userId}:${Date.now()}:${requestCounter}`;
}

function emit(payload) {
  runtime?.socket?.emit(SOCKET_NAMESPACE, { protocol: PROTOCOL, ...payload });
}

function currentAuthority() {
  return selectActionAuthority(runtime?.users?.());
}

function isCurrentAuthority() {
  const authority = currentAuthority();
  return Boolean(authority && authority.id === runtime?.user?.()?.id);
}

function respondToLockRequest(message, result) {
  emit({
    type: "lock-response",
    requestId: message.requestId,
    targetUserId: message.userId,
    actorUuid: message.actorUuid,
    ...result
  });
}

async function onSocketMessage(message) {
  if (!runtime || message?.protocol !== PROTOCOL) return;

  if (message.type === "lock-request") {
    if (!isCurrentAuthority()) return;
    const result = registry.acquire(message.actorUuid, message.requestId, message.userId);
    if (!result.granted) {
      respondToLockRequest(message, result);
      return;
    }

    let actor;
    try {
      actor = await runtime.resolveUuid?.(message.actorUuid);
    } catch (error) {
      console.error("Lyrian Chronicles | Could not resolve actor for action lock", error);
    }
    if (!actor || actorActionFingerprint(actor) !== message.state) {
      registry.release(message.actorUuid, message.requestId, message.userId, result.token);
      respondToLockRequest(message, { granted: false, reason: actor ? "stale" : "invalid" });
      return;
    }
    respondToLockRequest(message, result);
    return;
  }

  if (message.type === "lock-release") {
    if (!isCurrentAuthority()) return;
    registry.release(message.actorUuid, message.requestId, message.userId, message.token);
    return;
  }

  if (message.type === "lock-heartbeat") {
    if (!isCurrentAuthority()) return;
    registry.renew(message.actorUuid, message.requestId, message.userId, message.token);
    return;
  }

  if (message.type !== "lock-response" || message.targetUserId !== runtime.user()?.id) return;
  const pending = pendingLockRequests.get(message.requestId);
  if (!pending || pending.actorUuid !== message.actorUuid) return;
  pending.resolve({
    granted: Boolean(message.granted),
    reason: message.reason,
    token: message.token
  });
}

/** Register the Foundry system socket listener after the world is ready. */
export function initializeActionTransactions({ socket, users, user, resolveUuid, requestTimeout } = {}) {
  runtime?.socket?.off?.(SOCKET_NAMESPACE, onSocketMessage);

  runtime = {
    socket: socket?.on && socket?.emit ? socket : null,
    users: typeof users === "function" ? users : () => users,
    user: typeof user === "function" ? user : () => user,
    resolveUuid,
    requestTimeout: Number(requestTimeout) > 0 ? Number(requestTimeout) : DEFAULT_REQUEST_TIMEOUT
  };
  if (!runtime.socket) return false;
  socket.on(SOCKET_NAMESPACE, onSocketMessage);
  return true;
}

/** Reset module state for isolated tests. */
export function resetActionTransactions() {
  for (const pending of pendingLockRequests.values()) {
    pending.resolve({ granted: false, reason: "reset" });
  }
  pendingLockRequests.clear();
  registry.clear();
  runtime?.socket?.off?.(SOCKET_NAMESPACE, onSocketMessage);
  runtime = null;
}

async function acquireAuthoritativeLock(actor) {
  if (!runtime) return { granted: true, localOnly: true };

  const user = runtime.user();
  const authority = currentAuthority();
  if (!user || !authority) return { granted: false, reason: "no-authority" };

  const actorUuid = actor?.uuid;
  const requestId = nextRequestId(user.id);
  if (!actorUuid) return { granted: false, reason: "invalid" };

  if (authority.id === user.id) {
    const result = registry.acquire(actorUuid, requestId, user.id);
    return { ...result, actorUuid, requestId, userId: user.id, localAuthority: true };
  }
  if (!runtime.socket) return { granted: false, reason: "no-authority" };

  const response = new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingLockRequests.delete(requestId);
      resolve({ granted: false, reason: "timeout" });
    }, runtime.requestTimeout);
    pendingLockRequests.set(requestId, {
      actorUuid,
      resolve: (result) => {
        clearTimeout(timer);
        pendingLockRequests.delete(requestId);
        resolve(result);
      }
    });
  });

  emit({
    type: "lock-request",
    actorUuid,
    requestId,
    userId: user.id,
    state: actorActionFingerprint(actor)
  });
  return { ...(await response), actorUuid, requestId, userId: user.id };
}

function releaseAuthoritativeLock(lock) {
  if (lock?.heartbeat) clearInterval(lock.heartbeat);
  if (!lock?.granted || lock.localOnly) return;
  if (lock.localAuthority) {
    registry.release(lock.actorUuid, lock.requestId, lock.userId, lock.token);
    return;
  }
  emit({
    type: "lock-release",
    actorUuid: lock.actorUuid,
    requestId: lock.requestId,
    userId: lock.userId,
    token: lock.token
  });
}

function startLockHeartbeat(lock) {
  if (!lock?.granted || lock.localOnly) return;
  lock.heartbeat = setInterval(() => {
    if (lock.localAuthority) {
      registry.renew(lock.actorUuid, lock.requestId, lock.userId, lock.token);
      return;
    }
    emit({
      type: "lock-heartbeat",
      actorUuid: lock.actorUuid,
      requestId: lock.requestId,
      userId: lock.userId,
      token: lock.token
    });
  }, HEARTBEAT_INTERVAL);
}

/**
 * Prevent overlapping actions for one actor both locally and across clients.
 * The active GM is the sole lock authority; the caller still performs its own
 * permission-checked document updates, so this protocol grants no privileges.
 */
export async function runExclusiveActorAction(actor, operation) {
  if (!actor || pendingActions.has(actor)) {
    return { started: false, reason: "busy", value: undefined };
  }

  pendingActions.add(actor);
  let lock;
  try {
    lock = await acquireAuthoritativeLock(actor);
    if (!lock.granted) {
      return { started: false, reason: lock.reason ?? "busy", value: undefined };
    }
    startLockHeartbeat(lock);
    return { started: true, value: await operation() };
  } finally {
    releaseAuthoritativeLock(lock);
    pendingActions.delete(actor);
  }
}

/**
 * Serialize actor resource mutations on this client so each operation reads
 * the result of the previous update. Gameplay actions additionally use the
 * active-GM lock above to prevent stale reads between different clients.
 */
export async function queueActorTransaction(actor, operation) {
  if (!actor) return operation();

  const previous = transactionTails.get(actor) ?? Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tail = previous.then(() => gate);
  transactionTails.set(actor, tail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (transactionTails.get(actor) === tail) transactionTails.delete(actor);
  }
}
