import { AsyncLocalStorage } from "node:async_hooks";

type WriteTransaction<TTarget> = {
  getTarget: () => TTarget;
  begin: (target: TTarget) => void;
  commit: (target: TTarget) => void;
  rollback: (target: TTarget) => void;
};

export function createSerializedReentrantWriteExecutor<TTarget>(
  transaction: WriteTransaction<TTarget>,
) {
  let writeQueue: Promise<void> = Promise.resolve();
  const activeTarget = new AsyncLocalStorage<TTarget>();

  return function executeWrite<T>(work: (target: TTarget) => T | Promise<T>): Promise<T> {
    const currentTarget = activeTarget.getStore();
    if (currentTarget) {
      return Promise.resolve().then(() => work(currentTarget));
    }

    const run = async () => {
      const target = transaction.getTarget();
      transaction.begin(target);
      try {
        const result = await activeTarget.run(target, () => work(target));
        transaction.commit(target);
        return result;
      } catch (error) {
        transaction.rollback(target);
        throw error;
      }
    };

    const result = writeQueue.then(run, run);
    writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
