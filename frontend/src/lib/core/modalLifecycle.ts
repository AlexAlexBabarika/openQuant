const locks = new Map<HTMLElement, { count: number; inert: boolean }>();

/** Bits owns focus and Escape; portaled workbenches also make the background inert. */
export function createModalLifecycle() {
  let release = () => {};
  return {
    open(node: HTMLElement | null) {
      release();
      if (!node) return;
      const background = Array.from(
        node.ownerDocument.querySelectorAll<HTMLElement>(
          '#app, [data-dialog-content]',
        ),
      ).filter(el => el !== node && !el.contains(node));
      for (const el of background) {
        const lock = locks.get(el) ?? { count: 0, inert: el.inert };
        lock.count++;
        locks.set(el, lock);
        el.inert = true;
      }
      release = () => {
        for (const el of background) {
          const lock = locks.get(el);
          if (!lock || --lock.count > 0) continue;
          el.inert = lock.inert;
          locks.delete(el);
        }
        release = () => {};
      };
    },
    close() {
      release();
    },
  };
}
