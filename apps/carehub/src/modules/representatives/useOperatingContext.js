import { useEffect, useState } from 'react'
import { representativesRepository } from './repositories'

const NONE = { isMainAccount: false, accountKind: 'business', isRepresentative: false }

// The signed-in account's place in the importer/manufacturer operating models, for navigation:
//   isMainAccount     the company's own (top-level) account: the Representatives page lives here
//   accountKind       'rep_account' for a representative's independent account (Decentralised)
//   isRepresentative  the signed-in person is an active representative (shows "My company account")
// Only importers and manufacturers ask the database; every other business gets the empty context at once. A failure
// (or the migration not applied yet) also gives the empty context: nothing extra is shown and nothing is hidden.
export function useOperatingContext(brand) {
  const isImporter = (brand?.business_type || brand?.type) === 'manufacturer_importer'
  const [state, setState] = useState({ loaded: !isImporter, profile: null, repProfile: null, context: NONE })

  useEffect(() => {
    if (!brand?.id || !isImporter) { setState({ loaded: true, profile: null, repProfile: null, context: NONE }); return undefined }
    let alive = true
    setState((s) => ({ ...s, loaded: false }))
    Promise.all([
      representativesRepository.accountProfile(brand.id).catch((e) => { console.error('[operating-model] profile:', e); return { profile: null } }),
      representativesRepository.myProfile().catch((e) => { console.error('[operating-model] representative:', e); return { profile: null } }),
    ]).then(([p, r]) => {
      if (!alive) return
      const profile = p.profile
      setState({
        loaded: true,
        profile,
        repProfile: r.profile,
        context: {
          isMainAccount: !!profile?.operating_model && !brand.parent_business_id,
          accountKind: profile?.account_kind || 'business',
          isRepresentative: !!r.profile,
        },
      })
    })
    return () => { alive = false }
  }, [brand?.id, brand?.parent_business_id, isImporter])

  return state
}
