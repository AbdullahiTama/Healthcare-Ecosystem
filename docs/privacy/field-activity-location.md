# Field activity: how staff location is used

Status: **draft for the owner and counsel. Not legal advice.** The lawful-basis section is deliberately empty
until it has been reviewed against the Nigeria Data Protection Act (NDPA) and its 2025 General Application and
Implementation Directive, which the research behind this feature did not read in full.

## What the app does today (verified against the code)

| Question | Answer | Where it is enforced |
|---|---|---|
| When is a position taken? | Only when the person presses Check in or Check out, or opens the Log Activity form (and Try again there). | `modules/checkins/locationCapture.js` is called only from those handlers; nothing uses `watchPosition`. |
| Is anyone tracked in the background? | No. Nothing is captured between those moments. | Same. |
| What is stored? | Latitude, longitude, the accuracy of the fix, the time, and a coarse area name looked up from the position. A failed capture stores no position, only the reason. | `staff_checkins`, `field_activities` (`lat`, `lng`, `gps_accuracy_m`, `location_label`). |
| Who sees a check-in position? | The person; the owner and managers through `manager_checkin_overview`, and every such look is written to `location_access_log`. | `carehub_20261130_staff_checkins.sql`. |
| Who sees a report's position? | The author, the owner, managers and people granted all-activity access, and colleagues the report was shared with. | Row level security on `field_activities`, `activity_viewers`. |
| Photos | Re-encoded in the browser, which removes the EXIF block and any GPS position the camera embedded. Stored privately; visible exactly as the report is. | `modules/live-activity/photoPrep.js`, bucket `activity-photos` (draft). |
| What does the person read in the app? | A one-line notice at both capture points and an expandable explanation. | `modules/checkins/LocationNotice.jsx`. |

## Staff rights as built

- A person can read their own reports and check-ins in the app.
- There is no self-service correct or delete. The app tells people to ask their company owner. **Unverified:** that
  the owner (or a platform admin) can in fact correct or remove a report through the app or the database for
  every table involved; check-ins in particular are append-only by design, so they cannot be removed at all today.
  Verify this, or change the notice's wording, before the notice is relied on.

## Retention: open decisions

1. **Reports (`field_activities`).** A purge is drafted and **not scheduled**:
   `docs/architecture/pending-migrations/carehub_20261025_purge_old_report_coordinates.sql`. It removes the
   person's position from reports older than N months and keeps everything else. N is not decided
   (`LOCATION_RETENTION_MONTHS` in `modules/checkins/locationPolicy.js` is `null`, and the notice says only that the
   company decides). The author's guess, not researched: 12 months.
2. **Check-ins (`staff_checkins`) have no retention at all, and the draft does not change that.** Every captured
   row must carry coordinates (a table constraint) and the table refuses UPDATE and DELETE by trigger. Removing old
   positions therefore needs a deliberate, audited exception to that guard. That weakens a security control, so it
   is a decision for the owner and a security review, not something to add quietly. Until it is made, check-in
   positions are kept indefinitely and the notice does not claim otherwise.
3. **`location_access_log`** (who looked at whose position) is evidence and should not be purged on the same
   schedule; decide its own period.

## Lawful basis and impact assessment

> Pending counsel review: NDPA. Not asserted here. Employee monitoring under the NDPA is described by practitioner
> commentary as requiring a justification, an impact assessment and a published policy, with staff keeping rights
> of access, correction and objection. Confirm the lawful basis for location capture, whether consent is the right
> basis for staff, and whether a registration or notification duty applies.

An impact assessment for this feature should at least record: the purpose (evidence that a visit was where the
report says, and coverage of territories); that capture is user-triggered and never continuous; the data kept and
who can read it; the access log; the retention decision above; and the alternatives considered (no location,
or manager-only location).

## Open questions

- The retention period for report positions, and whether to build the audited exception for check-ins.
- Whether reps hand out product samples: if so a sample register is a separate project, and no Nigerian rule on it
  was confirmed by this research.
