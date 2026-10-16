import { useEffect, useRef } from "react";

/**
 * A ref that always holds the latest value. For handing live state into
 * long-lived closures (editor plugin chains, event handlers built once)
 * that would otherwise capture the value from the render they were created
 * in and never see updates.
 */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
