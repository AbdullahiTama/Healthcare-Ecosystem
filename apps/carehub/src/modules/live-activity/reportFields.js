// Report fields a business has not configured yet.
//
// A new business has no rows in activity_fields, and only its owner can add them.
// Blocking everyone else from logging until then meant a rep's first report
// failed with a toast. Instead the form falls back to one built-in note, so a
// first report is always possible. Nothing is written to the database for this:
// the answer is saved in values_json under a fixed key, and shown in the feed
// under the same label. Once the owner defines real fields the form uses those;
// reports made with the note keep showing it.

export const DEFAULT_SUMMARY_FIELD_ID = 'default-summary'

export const DEFAULT_REPORT_FIELDS = [
  { id: DEFAULT_SUMMARY_FIELD_ID, label: 'What happened', field_type: 'long text', required: true, options: null, sort_order: 0 },
]

// The fields the form, validation and columns should use right now.
export function effectiveFields(fields) {
  return fields && fields.length > 0 ? fields : DEFAULT_REPORT_FIELDS
}

// The label for a stored value, including notes saved before custom fields existed.
export function fieldLabel(fields, id) {
  const found = (fields || []).concat(DEFAULT_REPORT_FIELDS).filter(function (f) { return f.id === id })[0]
  return found ? found.label : null
}

// Names of required fields that are empty. Whitespace is empty.
export function missingRequired(fields, values) {
  return fields.filter(function (f) {
    return f.required && !String(values[f.id] == null ? '' : values[f.id]).trim()
  }).map(function (f) { return f.label })
}
