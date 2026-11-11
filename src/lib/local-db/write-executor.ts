import { AsyncLocalStorage } from "node:async_hooks";

type WriteTransaction<TTarget> = {
  getTarget: () => TTarget;
  begin: (cible: TTarget) => void;
  commit: (cible: TTarget) => void;
  rollback: (cible: TTarget) => void;
};

export function createSerializedReentrantWriteExecutor<TTarget>(
  transaction: WriteTransaction<TTarget>,
) {
  let writeQueue: Promise<void> = Promise.resolve();
  const activeTarget = new AsyncLocalStorage<TTarget>();

  return function executeWrite<T>(work: (cible: TTarget) => T | Promise<T>): Promise<T> {
    const currentTarget = activeTarget.getStore();
    if (currentTarget) {
      return Promise.resolve().then(() => work(currentTarget));
    }

    const run = async () => {
      const cible = transaction.getTarget();
      transaction.begin(cible);
      try {
        const resultat = await activeTarget.run(cible, () => work(cible));
        transaction.commit(cible);
        return resultat;
      } catch (erreur) {
        transaction.rollback(cible);
        throw erreur;
      }
    };

    const resultat = writeQueue.then(run, run);
    writeQueue = resultat.then(
      () => undefined,
      () => undefined,
    );
    return resultat;
  };
}
