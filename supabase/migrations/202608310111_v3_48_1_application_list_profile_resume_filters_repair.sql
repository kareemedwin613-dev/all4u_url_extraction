-- Repair: ensure only the profile/resume filter overload of list_applications_v07 remains.

drop function if exists public.list_applications_v07(
  text, uuid, text, text, text, text, uuid, text, text, uuid, text, integer, integer
);

notify pgrst, 'reload schema';
