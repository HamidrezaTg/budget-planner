# Hosted Service Launch Plan

This plan tracks the work required before accepting users or payments at
`https://gulden.app`. The hosted service uses the AGPL-3.0-only Gulden code;
the self-hosted software remains available under that license.

## Confirmed

- Service and domain: `https://gulden.app`
- Service operator: Hamidreza Nateghi
- Support, legal, privacy, and trademark email: `hr.nateghi@gmail.com`
- Next software version prepared: `3.23.1`
- Previous release `v3.23.0`: remains MIT-licensed

## Blocked on Owner Details

Provide these details before the Terms and Privacy Policy can be finalised:

- [ ] Full postal address for legal notices and privacy requests.
- [ ] Country and state/province whose law governs the hosted-service Terms.
- [ ] Court venue or dispute-resolution method.
- [ ] Effective date for the Terms and Privacy Policy.
- [ ] Minimum user age.
- [ ] Liability-cap decision, such as fees paid during the previous 12 months.

## Billing Decisions

- [ ] Select a payment provider, such as Stripe, Paddle, or Lemon Squeezy.
- [ ] Define monthly plans, prices, currency, taxes, and included limits.
- [ ] Decide whether subscriptions renew automatically each month.
- [ ] Decide whether cancellation ends access immediately or at the end of the
  paid period.
- [ ] Define the refund policy.
- [ ] Provide the billing portal or account-cancellation flow.
- [ ] Decide whether an invoice or receipt is required for each payment.

## Data and Privacy Decisions

- [ ] Identify hosting, database, storage, email, monitoring, and support
  providers.
- [ ] Confirm the hosting country or region.
- [ ] List every optional AI, OCR, notification, exchange-rate, analytics, or
  other external provider used by the hosted service.
- [ ] Provide the public documentation or privacy-policy URLs for those
  providers.
- [ ] Choose the account-deletion process.
- [ ] Choose the data-export window after cancellation.
- [ ] Choose how long deleted accounts and backups are retained.
- [ ] Confirm whether analytics or marketing cookies are used. The default
  recommendation is essential cookies only.
- [ ] Decide whether users can opt out of optional AI/OCR processing.

## Product and Operations

- [ ] Create hosted-service Terms and Privacy pages on `gulden.app`, or confirm
  that linking to the repository documents is sufficient.
- [ ] Add a paid signup and billing flow.
- [ ] Configure account deletion and data export.
- [ ] Configure backups, restore testing, monitoring, incident response, and
  abuse handling.
- [ ] Add a visible AGPL source link and legal notice in the hosted UI.
- [ ] Confirm the hosted service offers Corresponding Source for any modified
  version as required by AGPL section 13.
- [ ] Finalise the trademark policy and reserve official domains and accounts.
- [ ] Have the Terms, Privacy Policy, payment flow, and data handling reviewed
  by a qualified lawyer before launch.

## Release Sequence

1. Complete the owner, billing, and privacy decisions above.
2. Replace every remaining placeholder in `TERMS_OF_SERVICE.md` and
   `PRIVACY_POLICY.md`.
3. Publish the final legal pages on `gulden.app` and link them from the app.
4. Update the AUR source URL and checksum after the `v3.23.1` release artifact
   is built.
5. Run the release gate, create the `v3.23.1` tag, and publish the release.
6. Verify signup, payment, cancellation, export, deletion, and source-link
   flows in production.
