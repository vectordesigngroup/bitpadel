# Quick card: lost or stolen card

Print this page. A manager finishes the admin steps. Details are in the [operating manual](../01-operating.md).

## Desk, immediately

1. Take the member's name and membership label.
2. Do not hand them someone else's card.
3. Let them in with the fob, PIN, or a staff escort if they still need to enter.
4. Call a manager. You cannot mark a card lost without the admin token.

## Manager, in Admin

1. Open `/admin` and find the member.
2. On the active card line, press **Mark lost** (stolen or missing) or **Revoke card**.
3. Confirm the next tap says "That card is not active."
4. Program a new NTAG 424 DNA with `npm run card:program`, or press **Enroll card** with the new UID after it is programmed. The button enrolls scheme `ntag424-sun`.
5. If the card was stolen, do not enroll that same UID again. Enrolling a lost UID again turns it back on and resets the counter.
6. Lost phone instead of a card: **Revoke key**, then **Enrollment QR** so they can enroll the replacement wallet.

Programming steps: [NFC card programming](../../nfc-card-programming.md).

## Do not

- Do not put the club's NFC keys in email or in git.
- Do not use a Bolt Card (a payment card) as the replacement door card.
