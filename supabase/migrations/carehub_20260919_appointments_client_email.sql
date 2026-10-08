-- Migration: Add client_email to appointments
-- Allows storing an email captured at booking time so the client can be
-- emailed their appointment confirmation (appointment_confirmed template).

alter table public.appointments
  add column if not exists client_email text;

comment on column public.appointments.client_email is
  'Email address captured at booking time for appointment confirmation emails.';