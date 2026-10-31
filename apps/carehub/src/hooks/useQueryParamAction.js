import { useEffect } from 'react'
import { useInRouterContext, useSearchParams } from 'react-router-dom'

const NO_PARAMS = [new URLSearchParams(), () => {}]

// Opens the record a link names in its query string (?purchase=<id>), once,
// then drops the parameter so a refresh or Back does not open it again. Used
// by the Owner's activity feed to land on the exact purchase, expense or debt.
//
// `ready` holds the action until the page can act on it (its list loaded).
// A page rendered outside a router (component tests) simply has no parameter;
// whether a page is inside a router never changes during its life, so the
// hook order is stable.
export function useQueryParamAction(name, action, ready = true) {
  const routed = useInRouterContext()
  const [params, setParams] = routed ? useSearchParams() : NO_PARAMS
  const value = params.get(name)
  useEffect(() => {
    if (!value || !ready) return
    action(value)
    const next = new URLSearchParams(params)
    next.delete(name)
    setParams(next, { replace: true })
  }, [value, ready])
}
