interface PendingRequest<T> {
  readonly controller: AbortController;
  readonly promise: Promise<T>;
  subscribers: number;
  settled: boolean;
}

/** A caller can cancel its subscription without cancelling another caller's work. */
export class SingleFlight<T> {
  private readonly pending = new Map<string, PendingRequest<T>>();

  join(key: string, start: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    let request = this.pending.get(key);
    if (!request) {
      const controller = new AbortController();
      const promise = Promise.resolve().then(() => start(controller.signal));
      request = { controller, promise, subscribers: 0, settled: false };
      this.pending.set(key, request);
      const entry = request;
      const finish = () => {
        entry.settled = true;
        if (this.pending.get(key) === entry) this.pending.delete(key);
      };
      void promise.then(finish, finish);
    }
    const entry = request;
    entry.subscribers++;
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      const leave = () => {
        if (finished) return false;
        finished = true;
        signal?.removeEventListener("abort", cancel);
        entry.subscribers--;
        if (!entry.settled && entry.subscribers === 0) {
          if (this.pending.get(key) === entry) this.pending.delete(key);
          entry.controller.abort();
        }
        return true;
      };
      const cancel = () => { if (leave()) reject(signal?.reason); };
      signal?.addEventListener("abort", cancel, { once: true });
      void entry.promise.then(
        value => { if (leave()) resolve(value); },
        error => { if (leave()) reject(error); },
      );
    });
  }
}
