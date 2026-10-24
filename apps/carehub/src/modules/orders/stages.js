// The order pipeline and what each stage is called. Shared by the Orders page and by field reports that show
// the orders a visit produced.
export const PIPELINE = ['submitted', 'approved', 'processing', 'dispatched', 'delivered']

export const STAGE_LABEL = {
  submitted: 'Awaiting Approval',
  approved: 'Approved',
  processing: 'Warehouse Processing',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  rejected: 'Rejected',
}
