import { useEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";

export const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Time (performance.now) the element first scrolled into view, or null until then. */
export function useInView<T extends Element>(): [RefObject<T | null>, number | null] {
  const ref = useRef<T>(null);
  const [seenAt, setSeenAt] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || seenAt != null) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setSeenAt(performance.now()); io.disconnect(); }
    }, { rootMargin: "0px 0px -6% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seenAt]);
  return [ref, seenAt];
}

/** Eases from 0 up to `target`; jumps straight there for reduced-motion users. */
export function useCountUp(target: number, ms = 900) {
  const reduced = prefersReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setN(Math.round(target * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduced]);
  return reduced ? target : n;
}

let queue: Promise<unknown> = Promise.resolve();

/** Runs a React state update inside a View Transition. Transitions are queued so a fast
 * response can't cut the previous one short. Falls back to a plain update where unsupported. */
export function withViewTransition(update: () => void) {
  if (!document.startViewTransition || prefersReducedMotion()) { update(); return; }
  queue = queue
    .then(() => document.startViewTransition(() => flushSync(update)).finished)
    .catch(() => {});
}
