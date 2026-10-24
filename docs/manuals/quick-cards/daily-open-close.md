# Quick card: daily open and close

Print this page. Full lists are in the [operating manual](../01-operating.md). Record exceptions on the [maintenance log](../maintenance-log.md).

## Open

1. Kiosk loads and shows both safety lines (entry pulse only, leaving does not use this screen).
2. Select the area. A wallet QR appears.
3. Desk loads with the staff token. Note who is still checked in.
4. Booking page shows today's slots. Imported times have no **Hold and get invoice** button.
5. Read Playtomic conflicts on the desk. Leave them for a manager.
6. Walk out through the exit with no phone and no card.
7. If the UID-only warning is visible, tell a manager before you rely on cards.

## During the day

- Paid courts show "Booked. Payment settled."
- Unpaid holds drop off after the hold window (default 15 minutes).
- Check out people when they leave.

## Close

1. Check out anyone who has gone.
2. Skim the admin access log for `door-failed` if you have the admin token. Otherwise tell a manager what the kiosk said.
3. A manager may download the bookings CSV (latest 500 settled Lightning bookings, not a full cash-up).
4. Leave open Playtomic conflicts for the next manager.
5. You do not shut the exit. There is no close command that locks the building.

**Not yet implemented:** a cash-up screen and a combined Playtomic revenue report.
