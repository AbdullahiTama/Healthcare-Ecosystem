import { createContext, useContext, useEffect, useState } from 'react'
import { settingsRepository } from '../modules/settings/repositories'
import { fromServer, estimateFromBrand } from '../lib/planStatus'
import { isMissingObject } from '../lib/dbErrors'

// The business's plan status (lib/planStatus.js), loaded once by the dashboard and shared with every screen, so the
// banner, the daily popup and each paused action agree. Outside a provider (a screen rendered on its own) the status
// is null, which restricts nothing: the database still refuses what an expired plan does not allow.
const PlanStatusContext = createContext(null)

export function PlanStatusProvider({ brand, children }) {
  const status = useLoadedPlanStatus(brand)
  return <PlanStatusContext.Provider value={status}>{children}</PlanStatusContext.Provider>
}

export function usePlanStatus() {
  return useContext(PlanStatusContext)
}

// Starts from an estimate (never restricted) and replaces it with the database's answer. Reloads when the business
// or its expiry changes, so a renewal clears the alerts at once.
function useLoadedPlanStatus(brand) {
  const brandId = brand?.id
  const expiresAt = brand?.plan_expires_at
  const [status, setStatus] = useState(() => (brand ? estimateFromBrand(brand) : null))
  useEffect(() => {
    if (!brandId) { setStatus(null); return }
    let live = true
    setStatus(estimateFromBrand(brand))
    settingsRepository.getPlanStatus(brandId)
      .then((json) => { if (live) setStatus(fromServer(json) || estimateFromBrand(brand)) })
      .catch((e) => {
        // Not deployed yet, or offline: keep the estimate. Only an unexpected failure is worth a warning.
        if (!isMissingObject(e)) console.warn('[plan] status could not be loaded:', e?.message || e)
      })
    return () => { live = false }
  }, [brandId, expiresAt]) // the brand object itself changes identity on every render; these two are what matter
  return status
}
