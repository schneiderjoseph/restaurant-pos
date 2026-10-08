import { MouseEvent, PointerEvent, useCallback, useEffect, useRef } from 'react';

interface Options {
  /** Hold time before the long press fires, in ms. */
  delay?: number;
  /** A finger moving further than this (px) is a scroll, not a press. */
  moveTolerance?: number;
}

/**
 * Long press (touch, pen or mouse held down) plus right-click on desktop.
 * Spread `handlers` on the element and pass its click through `wrapClick`: the click
 * that ends a long press is swallowed, so the item is not also added to the cart.
 */
export function useLongPress(onLongPress: () => void, { delay = 500, moveTolerance = 10 }: Options = {}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const callback = useRef(onLongPress);
  callback.current = onLongPress;

  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const fire = useCallback(() => {
    cancel();
    fired.current = true;
    callback.current();
  }, [cancel]);

  const onPointerDown = useCallback((event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    cancel();
    fired.current = false;
    origin.current = { x: event.clientX, y: event.clientY };
    timer.current = setTimeout(fire, delay);
  }, [cancel, delay, fire]);

  const onPointerMove = useCallback((event: PointerEvent) => {
    if (!origin.current) {
      return;
    }
    const dx = event.clientX - origin.current.x;
    const dy = event.clientY - origin.current.y;
    if (Math.hypot(dx, dy) > moveTolerance) {
      cancel();
    }
  }, [cancel, moveTolerance]);

  // Android shows its own menu on a held press, desktop on right-click: both open ours instead.
  const onContextMenu = useCallback((event: MouseEvent) => {
    event.preventDefault();
    if (!fired.current) {
      fire();
    }
  }, [fire]);

  const wrapClick = useCallback(<A extends unknown[]>(onClick: (...args: A) => void) => (...args: A) => {
    if (fired.current) {
      fired.current = false;
      return;
    }
    onClick(...args);
  }, []);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      onContextMenu,
    },
    wrapClick,
  };
}
