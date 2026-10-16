---
name: Phone number validation
overview: The profile phone field accepts any text, and a rejected save only shows a generic HTTP error. Validate with libphonenumber-js on the form and on the API, and store the number as E.164.
todos:
  - id: schema
    content: Validate phoneNumberSchema with libphonenumber-js and update tests
    status: completed
  - id: form
    content: Validate the profile phone field before save and show badPhone
    status: completed
isProject: false
---

# Phone number validation

The profile field in [`client/expo/app/(main)/profile.tsx`](<client/expo/app/(main)/profile.tsx>) sends `phone.trim()` with no check. [`lib/schemas/src/phone.ts`](lib/schemas/src/phone.ts) only requires 7–20 characters of digits and separators, so `1234567` passes. Zod failures come back as `{ errors: [...] }`, while the client only reads `error`, so the screen shows `http_400` instead of the existing `errors.profile.badPhone` copy.

## Rule

Use `libphonenumber-js/min`. A number is valid when `isValidPhoneNumber` accepts it. Input without a leading `+` is parsed as a US number; input with `+` is parsed as an international number. On success, store the E.164 form (for example `+12025550123`). A blank value still clears the number.

`555-0100` is not a valid number under this check. Identity and member tests that use it need a number the library accepts.

## Changes

- Add `libphonenumber-js` to [`lib/schemas`](lib/schemas/package.json) and [`client/expo`](client/expo/package.json).
- Replace the length-and-character regex in [`lib/schemas/src/phone.ts`](lib/schemas/src/phone.ts) with a refine that checks `isValidPhoneNumber` and a transform to E.164. Zod `.transform` changes the inferred type of the request body, so prefer `superRefine` plus normalizing in the identity update handler if the generated `UpdateProfileBody` type must stay a string. The stored value is E.164 either way.
- On save in [`client/expo/app/(main)/profile.tsx`](<client/expo/app/(main)/profile.tsx>), run the same check before the request. Reject with `errors.profile.badPhone` through `SubmitButton`, and send the E.164 value. Use `keyboardType="phone-pad"` on that field (extend `Field` only enough to pass it through).
- Cover the helper with a unit test: a valid US number, a valid `+` international number, and a reject for `1234567`.
