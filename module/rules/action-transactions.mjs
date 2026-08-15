const pendingActions = new WeakSet();
const transactionTails = new WeakMap();

/**
 * Prevent two actions for the same actor from executing concurrently on one client.
 * The caller decides how to report a rejected duplicate action.
 */
export async function runExclusiveActorAction(actor, operation) {
  if (!actor || pendingActions.has(actor)) return { started: false, value: undefined };

  pendingActions.add(actor);
  try {
    return { started: true, value: await operation() };
  } finally {
    pendingActions.delete(actor);
  }
}

/**
 * Serialize actor resource mutations so each operation reads the result of the
 * previous update instead of calculating from the same stale resource snapshot.
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
