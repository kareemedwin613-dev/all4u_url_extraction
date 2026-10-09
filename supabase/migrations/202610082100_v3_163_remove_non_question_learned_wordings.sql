-- v3.163 Remove learned wordings that were never questions.
--
-- Before the extension and API filtered them out, AI recognition was sometimes given text that is not a
-- question an applicant answers: a dropdown placeholder ("Select", "Search"), a generic control label
-- ("checkbox label"), only option words ("Yes", "No Yes"), cookie-banner items ("Targeting Cookies"), or a
-- plain contact label the contact rules fill ("First name", "Email"). Those rows were saved as "no standard
-- answer". They are removed here; rows mapped to a real answer are kept. Safe to re-run.

delete from public.autofill_learned_wordings
where target_key = 'none'
  and (
    normalized_question ~ '^(select( one)?|search|choose|type to search|please select|select an? option)$'
    or normalized_question ~ '^(checkbox|radio|toggle|switch|option|label|checkbox label|radio label|input|field|text|value|answer|response)$'
    or normalized_question ~ '^((yes|no|true|false|n a|na|none|other|maybe|i agree|agree|disagree|accept|decline|ok|okay)( |$))+$'
    or normalized_question ~ '\mcookies?\M'
    or normalized_question in ('first name', 'last name', 'full name', 'name', 'email', 'email address', 'phone', 'phone number',
      'preferred name', 'what is your preferred name', 'current company')
  );
