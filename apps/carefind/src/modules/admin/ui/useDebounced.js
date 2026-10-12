import { useEffect, useState } from 'react'

// The value, once it has been unchanged for `ms`. The timer restarts on every
// change and is cleared on unmount, so no update lands after the caller is gone.
export function useDebounced(value, ms) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}
