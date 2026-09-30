# Mobile form validation (MOB-04 §21-§25, §52, §85)

There is one validation: the shared `lib/forms` rules and server schemas. Nothing is stricter or looser on a phone.

1. Required is shown by the label mark and `aria-required`; the same `required` drives all three.
2. Timing: on blur and on submit; no errors while a person has barely started typing.
3. Placement: the message is beside the field, linked by `aria-describedby`, with `aria-invalid`.
4. After a failed submit: summary ("N fields need attention") with links that focus each field; focus goes to the first invalid field; a collapsed section with an error opens.
5. Server errors are mapped to fields when the action returns `fieldErrors`; otherwise a specific message with a reference, never just "Something went wrong".
6. A failed or unconfirmed save keeps every entered value.
7. A newer server version is a conflict to review, not an overwrite.
