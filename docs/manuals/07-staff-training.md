# Staff training guide

Use this when someone starts at the desk, as a coach who shares the floor, or as a manager. The software does not store training records. Print the sign-off sheet at the end and keep it with club files.

Read the [disclaimer](../../DISCLAIMER.md) before you talk about Bitcoin with members. Do not tell anyone to buy, sell, or hold Bitcoin. Do not promise savings, yield, or a return.

## Onboarding checklist

- [ ] Read the [operating manual](01-operating.md) and the four [quick cards](README.md#one-page-cards).
- [ ] Walk an exit with the server unplugged, or watch a manager do it. Say out loud that leaving does not use the kiosk.
- [ ] Load `/desk` with the staff token. Find headcount, **Check out**, today's Playtomic list, and conflicts.
- [ ] Open `/kiosk`, select an area, and read both safety lines.
- [ ] Watch one wallet unlock and one card tap. Read the success line.
- [ ] Add a guest count, open the guest form, and leave the marketing box unchecked. Confirm the success line.
- [ ] Hold a slot on `/` in the mode your club uses. On mock, watch a manager simulate payment. On BTCPay or LNbits, watch a small real payment until "Booked. Payment settled."
- [ ] Find "Imported booking covers this time" if the club uses Playtomic.
- [ ] Practice the lost-card handoff: you do not reprogram cards unless you are the manager. You call the manager and keep the old card from being used.
- [ ] Read the refund rule your club wrote. Admin can request a refund for a settled booking. It is not automatic, and LNbits needs a customer BOLT11.
- [ ] Know where the AED and the posted emergency note are. Write the local emergency number on that posted note, not in this repository.
- [ ] Complete the quiz below with a manager.

Coaches who do not take payment can stop after the door and guest items. They still follow the exit rule.

## Role cards

The app stores these roles. Front desk and coach share the desk permission. Owners and managers use Admin. A manager cannot create an owner. Shared tokens still work: `ADMIN_TOKEN` is full admin, `STAFF_TOKEN` is desk only.

### Front desk

You can:

- Load the desk, check people out, and read Playtomic names for today.
- Run the kiosk and the guest form.
- Hold a court slot and watch for settlement.
- Hand someone the [door-fault card](quick-cards/door-fault.md) steps: fallback entry, never block the exit.

You ask a manager when you need to:

- Add a member, enroll a wallet, mark a card lost, or change a price.
- Export CSV files.
- Map a Playtomic court or press **Sync now**.
- Rotate a token.

### Coach

You can teach and you can point players at the desk for payment and doors. You do not get a separate login. If you are handed the staff token, you have the same software power as the front desk. Do not take the admin token onto a phone that also has your personal apps if you can avoid it.

### Manager

You hold `ADMIN_TOKEN`. You follow the [admin manual](02-admin.md), the [maintenance manual](04-maintenance.md), and the [security manual](06-security-incident.md). You are the person who decides a refund in the processor, because this app cannot.

## Bitcoin and Lightning, for staff

Teach only this much.

- Bitcoin is a digital currency. Its price moves. People can lose money. The club does not give investment advice.
- Lightning is a way to pay a Bitcoin invoice quickly. The QR on the booking page is that invoice.
- The booking is real when the page says "Booked. Payment settled." A photo of a wallet screen is not proof.
- The amount in club currency is the slot price a manager entered. Sats are what the wallet sends. For LNbits, a manager set how many sats match one minor unit. The app does not look up a market rate. For BTCPay, BTCPay converts the currency amount.
- LNURL-auth at the door is a signature, not a payment. It does not show or spend the member's balance. The linking key is for this club only.
- Not every wallet can do LNURL-auth. Card entry is the other method this app supports. Fobs and PINs, if you have them, are separate hardware.
- A Bolt Card pays. A door card opens the entry. They are different jobs.
- This club's software does not mine Bitcoin. Playing, joining, or sponsoring does not earn Bitcoin. The "mine" line in the project README is a metaphor for community, which the disclaimer already explains.
- Sponsorship is not an investment. If a member asks about putting money into the business, send them to a manager and do not improvise. The sponsorship playbook is [`docs/07-sponsorship-playbook.md`](../07-sponsorship-playbook.md).

Longer lessons for the public live in the [Bitcoin hub playbook](../03-bitcoin-hub-playbook.md). Those are classes, not desk scripts.

## Scripted answers

**"Did my court payment go through?"**
"I will look at the booking. It counts when this page says the payment settled. A screenshot is not enough."

**"The door did not open."**
"You can always leave without this screen. For getting in, we will use the fob, PIN, or a staff member. I will read the line on the kiosk and call a manager if the relay failed."

**"Can I get a refund?"**
"The booking software does not send Bitcoin back. A manager handles refunds with the payment system, under the rule posted by the club."

**"Why is that hour blocked?"**
"The screen says an imported booking covers that time. It came from Playtomic. I cannot move it from this desk."

**"Do you sell Bitcoin? Should I buy some?"**
"No. We can show you how a Lightning payment works. We do not tell you what to buy."

**"I lost my card."**
"I will ask a manager to mark that card lost so it cannot open the door. They will enroll a new card. Please do not borrow someone else's."

**"Can my child use my card?"**
"Each person needs their own wallet or card. A household label does not unlock the door."

**"Will you email me about offers?"**
"Only if you check the marketing box yourself. It starts unchecked. This system does not send the email. It only records the choice."

**"The kiosk is dark."**
"Leaving still works. For entry, use the fob, PIN, or staff. I will tell a manager the server or the screen is down."

## Quiz and sign-off

Manager: ask these out loud. The answer key is at the bottom of this page.

1. What does a settled booking look like on the booking page?
2. Is a wallet screenshot enough to mark a court as paid?
3. What do you do if someone cannot get in and the kiosk says the entry controller did not respond?
4. What do you do if someone cannot get out?
5. Does the guest marketing box start checked or unchecked?
6. What do you tell a member who asks whether they should buy Bitcoin?
7. Who marks a card lost?
8. What does "Imported booking" mean on the public calendar?
9. Does checkout lock the door?
10. Where do prices in this repository come from?

### Answer key

1. The words "Booked. Payment settled."
2. No.
3. Use the fob, PIN, or staff. Do not block the exit. Tell a manager. The app does not retry the pulse.
4. Use the exit hardware. Do not wait for the app. Call for help if the exit itself fails. The app cannot release a door.
5. Unchecked.
6. The club does not give investment advice and does not tell them to buy.
7. A manager, in Admin, with **Mark lost** or **Revoke card**.
8. A read-only Playtomic booking. It blocks a Lightning hold. It does not show the player's email on that public page.
9. No. It only ends the visit on the desk list.
10. A manager types minor units per slot, or sets `DEFAULT_SLOT_PRICE_MINOR` for the generate API. The kit's financial model starts at zero. Staff do not invent a price.

### Sign-off

Name: ______________  Role (desk, coach, or manager): ______________

Date: ______________  Manager: ______________

Notes: ______________
