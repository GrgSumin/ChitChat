import { useEffect, useState } from "react";

export default function useDebounce<T>(value: T, delayMs: number = 300) {
  const [debounceValue, setDebounceValue] = useState(value);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounceValue(value), delayMs);
    return () => clearTimeout(timeout);
  }, [value, delayMs]);
  return debounceValue;
}
