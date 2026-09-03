-- Fix: drop the old 5-param overload of application_resume_download_filename_v352
-- to avoid ambiguous function resolution with the new 6-param version.

drop function if exists public.application_resume_download_filename_v352(text, text, text, text, text);
