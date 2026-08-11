# Messages — Business Domain

## Purpose
Internal correspondence for the manufacturer/wholesale vertical — threaded messages with To/CC recipients and file attachments, distinct from the clinical `patient_messages` thread used in the Hospital Workflow domain.

## Files
`apps/carehub/src/pages/dashboard/Messages.jsx` (the entire module).

## Components
Single default-exported component (thread list, thread detail, composer); no `TopBar` (same inconsistency as the other enterprise routes).

## Services
`lib/supabase.js`: `getMessageThreads`, `getThreadMessages` (uses an `or=(id.eq.X,parent_id.eq.X)` PostgREST filter to fetch a thread root plus its replies in one query), `getMessageRecipients`, `getMessageFiles`, `uploadMessageFile`, `sendMessage` (also fires a notification to recipients via the Notifications domain), `markMessageRead`, plus `getStaff` for the recipient picker.

## Dependencies
Notifications domain (`sendMessage` triggers `notify()` internally), Storage bucket `message-files`.

## Database Tables
`internal_messages`, `internal_message_recipients`, `internal_message_files`, Storage bucket `message-files` (public — no authentication required to view an attachment once its URL is known).

## Current State
Composing, threading, and file attachment are all implemented and functional. File uploads sanitize only the filename — there is no file-type or size validation before upload, and the destination Storage bucket is public.

## Missing Documentation
No document records the `message-files` bucket's public accessibility as an accepted tradeoff versus an unaddressed gap for what may be confidential internal correspondence attachments.
