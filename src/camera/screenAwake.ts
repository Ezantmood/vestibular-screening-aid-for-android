export interface ScreenAwakeOwner {
  setActive(active: boolean): void;
  release(): void;
}

/** Aggregate JS owners and serialize native writes, including delayed completions. */
export function createScreenAwakeCoordinator(
  setKeepAwake: (enabled: boolean) => Promise<unknown>,
  onError: (error: unknown) => void,
) {
  const owners = new Map<symbol, boolean>();
  let applied: boolean | null = false;
  let revision = 0;
  let running = false;
  const desired = () => [...owners.values()].some(Boolean);

  async function drain() {
    try {
      while (true) {
        // Recompute here: a disposed owner must never release a newer owner's flag.
        const enabled = desired();
        if (enabled === applied) return;
        const requestedRevision = revision;
        try {
          await setKeepAwake(enabled);
          applied = enabled;
        } catch (error) {
          // The native state is unknown after rejection. Retry on the next owner
          // change, or immediately when a change arrived during this call.
          applied = null;
          onError(error);
          if (revision === requestedRevision) return;
        }
      }
    } finally {
      running = false;
    }
  }

  function update() {
    revision += 1;
    if (running) return;
    running = true;
    void drain();
  }

  return {
    createOwner(active: boolean): ScreenAwakeOwner {
      const id = Symbol('screen-awake-owner');
      owners.set(id, active);
      update();
      let released = false;
      return {
        setActive(nextActive) {
          if (released) return;
          owners.set(id, nextActive);
          update();
        },
        release() {
          if (released) return;
          released = true;
          owners.delete(id);
          update();
        },
      };
    },
  };
}
