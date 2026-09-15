# Order Cancellation Feature

## Overview
Customers can cancel their orders with an optional reason. The feature supports cancellation for orders in `pending_payment` and `paid` (not yet accepted) states.

## Implementation Details

### Frontend Changes

#### OrderDetail.jsx
- **Cancel Modal**: Added a modal dialog for order cancellation with:
  - Optional reason textarea
  - "Keep Order" and "Cancel Order" buttons
  - Loading state during cancellation
  
- **Cancel Button Visibility**: Now shows for both:
  - `pending_payment` orders (before payment)
  - `paid` orders (after payment, before vendor acceptance)
  
- **Cancel Flow**:
  1. User clicks "Cancel Order" button
  2. Modal opens with reason input
  3. User optionally provides reason and confirms
  4. `orderRepository.cancel()` is called
  5. Order status updates to `cancelled`
  6. UI refreshes to show cancelled state

### Backend (Already Existed)

#### orderRepository.js
- `cancel(orderId, userId, reason)` method calls `cancel_shop_order` RPC

#### cancel_shop_order RPC (20260831_shop_pickup_and_verify.sql)
The RPC handles:
1. **Validation**: Checks order exists and isn't already delivered/cancelled/refunded
2. **Inventory Restoration**: Calls `shop_restore_inventory_on_cancel` to restore stock
3. **Status Update**: Sets order status to `cancelled`
4. **Payment Update**: Marks pending payments as `failed`
5. **Audit Trail**: Inserts status history entry with reason
6. **Notifications**: 
   - Customer notification via `notifications` table
   - Vendor notification via `staff_notifications` table

## User Experience

### When Can Customers Cancel?
- **Before Payment**: Orders in `pending_payment` status
- **After Payment**: Orders in `paid` status (before vendor accepts)
- **Cannot Cancel**: Orders already `accepted`, `processing`, `in_transit`, or `delivered`

### What Happens After Cancellation?
1. **Inventory**: Stock is automatically restored
2. **Payment**: 
   - If unpaid: Payment record marked as failed
   - If paid: Refund process would need to be initiated separately (not yet implemented)
3. **Notifications**: Both customer and vendor receive notifications
4. **Status**: Order shows as "Cancelled" in order list and detail views

## Testing Checklist

- [ ] Cancel order in `pending_payment` status
- [ ] Cancel order in `paid` status
- [ ] Verify reason is saved in status history
- [ ] Verify inventory is restored
- [ ] Verify customer receives notification
- [ ] Verify vendor receives notification
- [ ] Verify cannot cancel delivered orders
- [ ] Verify cannot cancel already cancelled orders

## Future Enhancements

1. **Refund Integration**: Implement Paystack refund API for paid orders
2. **Cancellation Policy**: Add time-based restrictions (e.g., cannot cancel after 2 hours)
3. **Vendor Approval**: Require vendor approval for cancellation of paid orders
4. **Cancellation Reasons**: Predefined reason dropdown with "Other" option
5. **Email Notifications**: Send email notifications in addition to in-app notifications

## Files Modified

- `apps/carefind/src/modules/shop/OrderDetail.jsx` - Added cancel modal and updated button visibility

## Files Already Implemented (No Changes Needed)

- `apps/carefind/src/modules/shop/orderRepository.js` - Cancel method already existed
- `apps/carehub/sql/20260831_shop_pickup_and_verify.sql` - RPC already implemented
- `apps/carehub/src/modules/ecommerce/Ecommerce.jsx` - Vendor order management already exists
