import type { SdkLogEntry } from '../store';

export function wrapWallet<T extends object>(
  instance: T,
  addSdkLog: (entry: SdkLogEntry) => void,
): T {
  return new Proxy(instance, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== 'function' || typeof prop === 'symbol') return orig;
      return function (...args: unknown[]) {
        const start = Date.now();
        const method = String(prop);
        try {
          const ret = (orig as Function).apply(target, args);
          // Only log async calls — sync getters (getNetwork, etc.) are called during
          // render and logging them would trigger Zustand state updates mid-render.
          if (ret instanceof Promise) {
            const id = crypto.randomUUID();
            const ts = new Date().toLocaleTimeString();
            return ret
              .then((result: unknown) => {
                addSdkLog({ id, ts, method, args, result, durationMs: Date.now() - start, status: 'ok' });
                return result;
              })
              .catch((err: unknown) => {
                addSdkLog({ id, ts, method, args, error: String(err), durationMs: Date.now() - start, status: 'error' });
                throw err;
              });
          }
          return ret;
        } catch (err) {
          addSdkLog({ id: crypto.randomUUID(), ts: new Date().toLocaleTimeString(), method, args, error: String(err), durationMs: Date.now() - start, status: 'error' });
          throw err;
        }
      };
    },
  });
}
