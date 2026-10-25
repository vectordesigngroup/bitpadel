# Quick card: front desk check-in

Print this page. Longer steps are in the [operating manual](../01-operating.md).

Leaving never uses this screen. If someone cannot get out, follow the [emergency manual](../08-emergency.md).

## Wallet

1. Kiosk is on `/kiosk` and an area is selected. A QR is on screen.
2. Member scans it with the wallet they enrolled.
3. Success line: "Entry pulsed." Their name shows, with a photo if one was stored.
4. They appear on `/desk`.

If the wallet is refused, read the line. Expired codes need a new scan. An unknown wallet needs a manager to open **Enrollment QR**.

## Card

1. Member taps the programmed card on the phone or the reader. They do not need the kiosk QR.
2. A good tap checks them in the same way.
3. "That card is not active" means lost or revoked. Use the [lost-card card](lost-card.md).

If the kiosk says UID-only cards are clonable, tell a manager. That mode is for development.

## Guests

1. After unlock, press **More** once per guest, up to the cap. A cap of zero (the default until a manager sets `GUEST_LIMIT`) rejects **More**.
2. Press **Name a guest**.
3. Name and email or phone. Waiver box is required and starts unchecked.
4. Leave the marketing box unchecked unless they ask to opt in.
5. Submit. The success line is "Guest added." The page does not show their privacy token.

## Playtomic

Match the person to **Today's imported bookings** on the desk. You cannot edit that booking here.

## Do not

- Do not mark a court paid from a wallet screenshot.
- Do not block the exit while the door is being fixed.
