import { newUuid } from '../../lib/uuid'

// A new activity id made on the client. The id is what makes a retry safe: the
// same id inserted twice is one row (see logActivity).
export const newActivityId = newUuid
