# Reliable Email System Scope

## At a Glance

| Feature | Status | Workflow | Spec |
|---|---|---|---|
| Reliable email system | in progress | Alpha | [0001](../../specs/_root/0001-reliable-email-system/index.md) |

## Reliable Email System

Status: in progress

Intent: Give CareHub and CareFind one reliable, correctly branded email path for Auth, registration, business review, and approved future activity.

Done when: The accepted spec acceptance criteria pass, required migrations are live, public email routes are closed, both apps pass real inbox checks, and safe operations recovery works.

### Decide It

* [x] Design it: [0001 reliable email system](../../specs/_root/0001-reliable-email-system/index.md)

### Build It

* [ ] Build it: /develop reliable email system

Milestones:

* [ ] Delivery foundation, Deno worker, Resend events, operations API, and old path removal. Covers AC-2, AC-3, AC-4, AC-5, AC-9, AC-10, AC-12, AC-13, and AC-16.
* [ ] CareFind membership, signup bridge, Auth hook, and Auth mail. Covers AC-6, AC-7, AC-8, AC-11, AC-14, and AC-15.
* [ ] CareHub Auth recovery, atomic registration, and business review mail. Covers AC-1, AC-6, AC-7, AC-8, AC-11, AC-14, and AC-15.
* [ ] Live verification, canary rollout, real inbox checks, and operations documentation. Covers AC-12, AC-14, AC-15, and AC-16.

### Verify It

* [ ] Verify it: /check verify reliable email system

### Test It

* [ ] Test it: /test reliable email system

## Deferred Follow Ups

1. Professional verification, business claim, staff claim, staff lifecycle, and referral decision mail.
2. Booking, order, payment, appointment, subscription, withdrawal, return, vendor, and stock alert mail.
3. Optional preferences and scheduled reminders.
