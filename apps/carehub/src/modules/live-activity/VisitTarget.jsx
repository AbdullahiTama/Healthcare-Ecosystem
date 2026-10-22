import { theme } from '../../styles/theme'
import FacilityPicker from './FacilityPicker.jsx'
import NearbyBusinessPicker from '../business-directory/components/NearbyBusinessPicker'

const { gray400, gray500, border, bg, danger } = theme

// The ONE place a rep says what the report is about. Two sources can suggest a
// place, and they are labelled as such:
//   - the CareHub directory (verified businesses kept by the platform team)
//   - map data (OpenStreetMap health facilities, or one a colleague added)
// A suggestion is just that. Nothing is recorded as the place visited until the
// rep chooses it, and choosing one replaces the other: a report names at most one
// target, so the feed, table, export and coverage figures cannot disagree about it.
// A GPS position near a place is evidence of where the phone was, never of a visit.
export default function VisitTarget({ gps, findingPlace, businessId, createdBy, facility, onFacility, business, onBusiness }) {
  const chooseFacility = function (f) { onFacility(f); if (f) onBusiness(null) }
  const chooseBusiness = function (c) { onBusiness(c); if (c) onFacility(null) }

  return (
    <section aria-labelledby='visit-target-h' style={{ marginBottom: '16px' }}>
      <h3 id='visit-target-h' style={{ margin: '0 0 2px', fontSize: '12px', fontWeight: '700', color: 'inherit' }}>
        Business or facility visited <span style={{ fontWeight: '500', color: gray400 }}>(optional)</span>
      </h3>
      <p style={{ margin: '0 0 8px', fontSize: '11.5px', color: gray500 }}>
        Places near you are only suggestions. Nothing is recorded as visited until you choose one, and your position alone never counts as a visit.
      </p>

      {!gps && (
        <div role='status' style={{ padding: '12px', borderRadius: '10px', border: `1px solid ${border}`, background: bg, fontSize: '12.5px', color: gray500 }}>
          {findingPlace
            ? 'Finding where you are…'
            : 'Your location is not available, so nearby places cannot be suggested. You can still log this report.'}
        </div>
      )}

      {gps && business && (
        <NearbyBusinessPicker gps={gps} selected={business} onSelect={chooseBusiness} />
      )}

      {gps && !business && (
        <>
          {!facility && <NearbyBusinessPicker gps={gps} selected={null} onSelect={chooseBusiness} />}
          <div style={{ fontSize: '10px', fontWeight: '800', color: gray400, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '2px 0 6px' }}>
            From map data
          </div>
          <FacilityPicker gps={gps} businessId={businessId} createdBy={createdBy} value={facility} onChange={chooseFacility} />
          {facility && (
            <button type='button' onClick={function () { chooseFacility(null) }}
              style={{ marginTop: '6px', background: 'none', border: 'none', color: danger, fontSize: '12px', fontWeight: '700', cursor: 'pointer', padding: 0 }}>
              Clear this choice
            </button>
          )}
        </>
      )}
    </section>
  )
}
