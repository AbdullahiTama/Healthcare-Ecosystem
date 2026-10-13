// Waits for `promise`, but at most `ms`; the timer is cleared when the promise
// settles first, so none leaks. Used to hold an action's in-flight key until
// the list refresh lands without letting a hung query keep controls disabled.
export const capped = (promise, ms) => {
  let timer
  const cap = new Promise(resolve => { timer = setTimeout(resolve, ms) })
  return Promise.race([promise, cap]).finally(() => clearTimeout(timer))
}
