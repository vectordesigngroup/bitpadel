# Privacy notice template

Replace the blanks with your club's facts. This is a starting point for a notice you publish yourself. **It is not legal advice.** Privacy, marketing, and text-message rules depend on where the club and the person are. In the United States, look at the state privacy laws that apply to you, CAN-SPAM for email, and the TCPA for texts. Where the GDPR applies, look at that too. Have a lawyer review the notice before you rely on it.

## What this club stores

The reference app can store, on the club's own server:

- A membership label, and optional name, phone, email, membership type, and household link.
- A photo for staff to compare at the desk or kiosk. The photo stays on the club server.
- Wallet linking keys and NFC card identifiers, plus an access log (credential type, time, area, result).
- A check-in while the person is on site, a guest count, and guest name plus email or phone when someone fills in the guest form.
- A waiver acknowledgement (version and time).
- A separate marketing-consent row, only when the person opts in or a Playtomic player record says they accept commercial communications.

Booking pages do not show player emails from an imported calendar. Staff screens can.

## What this club does not do in the reference app

- It does not send email or SMS. Exporting opted-in contacts is a file your own tools would use.
- It does not write those contacts into the marketing list unless the checkbox was turned on, or Playtomic reported an explicit opt-in.
- It does not use the visit log as the marketing list. The marketing export is contact, time, consent-text version, and source.
- It does not put photos on a public URL. The kiosk can show a photo only after a successful unlock, with that visit's token.

## Choices

- Marketing consent is off unless the person opts in. The stored row includes the time and the version of the consent text.
- Unsubscribe and deletion use the privacy token from the guest flow, or a staff action for a contact value.
- Visit rows follow the club's visit-retention setting. Marketing rows stay until the person unsubscribes or asks for deletion.
- Access logs follow the club's log-retention setting.

## Who can see it

Admin and staff tokens can open profiles, the on-site list, and photos. The admin token is also required for the marketing export. Guests and members do not see other people's contacts.

## Playtomic

If the club turns on read-only Playtomic sync, player emails from that API are stored so a visit can be matched to today's booking. They are personal data. They are added to marketing only when Playtomic says the player accepts commercial communications.
