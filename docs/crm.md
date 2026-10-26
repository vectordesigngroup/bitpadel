# Player CRM

A plan for the club owner to review. **Nothing on this page is built.** The roadmap line is in [ROADMAP.md](ROADMAP.md).

Staff get one page per person, drawn from the members, guests, bookings, check-ins, and consent the reference app already stores. The page is for running padel and pickleball: who plays, who is waiting to join, who asked to hear from the club, and who can fill an open court. It reads the member list the app already has.

> **Before any campaign, check SMS, email, and privacy rules with a Florida attorney.** In the United States, commercial email is covered by CAN-SPAM and texts by the TCPA. State privacy rules can apply as well. This page is not legal advice and it is not a consent form.

## What the club already keeps

The reference app in [`reference/club-box`](../reference/club-box) already stores the facts below. The CRM reads those records in place.

- **Member.** A label, active or revoked, optional name, phone, email, and photo. A membership-type word (the default stored today is "standard"). A household link. Door access is either a full member or booking-only. Staff create and revoke members. The app has no paid-until date and no membership purchase.
- **Player login.** An email, an optional phone, and a link to a member when the emails match. This is the "My bookings" sign-in.
- **Court bookings.** A confirmed booking can point at a player and a member. The amount is stored in minor units of the currency the club configured. Payment is Lightning or a card provider the club turned on. Playtomic bookings import read-only and list the people on that booking (name, email, and whether Playtomic says they accept commercial messages). Playtomic payment rows store a total as text and do not name the payer. The import does not include a Playtomic level.
- **Check-in.** Arrival, area, wallet or card, guest count, and checkout. A named guest has a name, an email or phone, a waiver version and time, and a privacy link. The marketing box starts unchecked.
- **Marketing consent.** A separate row: contact, time, the version of the consent text, and the source (`kiosk` or `playtomic`). Unsubscribe marks the row. A Playtomic row is created only when Playtomic reports that the player accepts commercial communications. A later "no" from Playtomic unsubscribes that Playtomic row and leaves a kiosk opt-in in place.
- **Messages.** Email is console (the default: a redacted log line, nothing delivered), SMTP, or Postmark. SMS is console, Twilio, or a webhook. Marketing sends only when the consent row is still active. Admin can send one marketing message to one opted-in contact. Receipts, login codes, privacy links, household notices, the daily sales email, and admin alerts are transactional and do not read the marketing checkbox. A booking reminder uses its own checkbox at checkout.
- **Staff.** Owner, manager, front desk, and coach. The marketing CSV is admin-only. Front desk and coach can use the desk.
- **Files the admin page already downloads.** Bookings CSV, sales CSV, end-of-day totals, marketing CSV, and a staff audit. The sales file has no payer names.

Photos, wallet linking keys, and card identifiers stay on the member record for the door and the desk. They stay out of the marketing file.

Visit rows and imported bookings follow the club's visit-retention setting. Access logs follow the log-retention setting. Marketing rows stay until the person unsubscribes or asks for deletion. Clearing a guest from the privacy page clears that guest's name and contact and the matching marketing value. It leaves the member profile, the photo, the wallet link, and the access log. Deleting a member is not implemented. The notice to edit is [`templates/privacy-notice.md`](../templates/privacy-notice.md). It is not legal advice.

## Player profile

One page per person. Most of it is the records above. A few fields are new, and someone types them.

| On the page | Where it comes from |
|---|---|
| Contact | Email and phone already stored on the member or the player login. Name stays optional. |
| Sport or sports | A new field: padel, pickleball, or both. The app does not store a sport today. |
| Skill level | A level the player sets, and an optional level a coach sets. The page stores who set it and when. |
| Playtomic level or DUPR | Optional fields someone types. The current Playtomic import has no level. A live read from Playtomic or DUPR waits until that service allows it and the player agrees. |
| How often they play | A count of check-ins and bookings already stored, for dates you pick on the report. The plan does not define an "active player." |
| Usual partners | An imported Playtomic booking already lists the people on that court. A local booking stores one player. A saved partners list waits until a booking names more than one person and staff choose to keep that list. |
| Clinics and tournaments | Shown from entries once the tournament plan records them. This CRM does not keep a second attendance list. See [tournaments.md](tournaments.md). |
| Membership status | Active or revoked, the membership-type word, the household, and full member or booking-only door access. |
| Spend | Court payments on bookings this app already ties to that player or member. Amounts stay in the smallest unit of the currency you configured (cents, when that is how you count). Playtomic payment rows stay out of this figure because they name no payer. Shop sales, lessons, and membership fees are not stored on a person today, so they are not in the figure. |

A renewal date, if you want one, is a date staff type. The app cannot derive one.

## Lead pipeline

People who are not members yet. The app has no lead table today. The community-growth playbook describes a waitlist form; the software does not store that form yet.

Sources:

- Waitlist or newsletter sign-up.
- A first-time guest from the desk form.
- A trial visit.

Stages, moved by a person on staff:

1. **New.** They signed up or visited.
2. **Invited.** Staff offered a trial or a first booking.
3. **Visited.** They have a check-in or a paid booking.
4. **Member.** Staff created a member record. The lead points at that member.
5. **Closed.** They asked to stop, or staff closed it. Closing a lead leaves the consent row as it is. Unsubscribe is its own step.

A Playtomic email becomes a lead when staff add it, or when your written process says a new club opt-in becomes a lead. The import itself does not open a lead.

## Segments and tags

A tag is a label staff apply. Four tags to start:

- **Beginners.** Staff apply it, or it follows the skill field once someone has set a level. The club decides which levels count as beginner.
- **Evening players.** Staff apply it. A later suggestion can use booking times after you write down which hours count as evening.
- **Lapsed members.** Staff apply it. A later suggestion can list members with no check-in and no booking for a stretch you choose. This plan does not choose that stretch.
- **Renewals due.** Staff apply it, or it follows a renewal date staff typed. With no paid-until date in the app, the software cannot decide that a renewal is due.

A campaign still requires an active marketing opt-in when a tag matches.

## Messages, campaigns, and quiet hours

Campaigns use the email and SMS providers the club already configured, and the same opt-in check as the one-contact send on the admin page. The provider does not decide consent. The app does.

- Marketing (a newsletter, a clinic note, a note that a court is open) goes to contacts whose marketing row is still active.
- Transactional messages stay as they are: receipts, login codes, privacy links, household notices, admin alerts, and the daily sales email. A booking reminder stays on its checkout checkbox.
- Each marketing email includes an unsubscribe path the app already has: the privacy link, or a staff unsubscribe for that contact.
- The app does not receive SMS replies, so it cannot record a STOP text. Marketing texts stay off until a Florida attorney describes the opt-out you need and the software can store it.
- Quiet hours are a window you write down, in the club timezone the app already uses. Marketing waits outside that window. This plan does not pick the hours. Login codes and receipts stay immediate, because the person just asked for them. Whether a booking reminder must also wait is a question for the attorney.
- Each send is stored: who, which channel, when, and which consent row allowed it.
- A spreadsheet import adds marketing consent only when the file has its own yes, the time, and the version of the text the person saw. Otherwise the row is a lead with no marketing permission.
- The default console providers deliver nothing. A campaign goes out after the club selects a real email or SMS provider.

The first version is a person pressing send: pick a tag, see who is opted in, send. Automatic notes (after a first guest visit, or when a typed renewal date is near) come later and follow the same consent and quiet-hour rules.

## Staff notes and tasks

These are new, and they sit apart from the door audit.

- A note is text, the staff person, and the time, on the player page.
- A task is a short line (call back, confirm a trial), an assignee, and done or not.
- Owner and manager can read notes. Who else can read them is your choice before anyone builds this. A coach skill rating is a profile field, so the player can be shown it later.
- Notes stay out of marketing exports.

## Finding a fourth

Staff start from an open court. The screen suggests people who play that sport, whose skill sits in a band you set, and whose bookings fall in hours you set. Someone appears only after they opt in to being suggested. That opt-in is separate from marketing consent. Staff send any message. The screen does not text the list on its own.

A kiosk board for "looking for a fourth" stays a later roadmap idea. This item is the staff screen.

## Reports

You pick the dates. The page ships with no targets.

- Check-ins and bookings in that period, per person, from the rows already stored.
- Court-booking totals from the sales report that already exists.
- Opted-in contacts by source, from the marketing CSV that already exists.
- Leads by stage, once leads exist.
- Open tasks, once tasks exist.

## Import and export

CSV, the same kind of file admin already downloads.

- Export of profile fields, leads, and tags for owner and manager. The marketing CSV stays the admin-only file of opted-in contacts. Wallet keys, card identifiers, photos, and door logs stay out of every CRM file.
- Import of a waitlist: name, contact, sport, and how they heard about the club. Consent is recorded only from an explicit consent column, with the time and the text version.

## Privacy

- The profile holds the fields in the table above. Sport and skill are optional.
- Visit and log retention stay on the settings you already choose. Notes and leads need a retention period your attorney agrees to before those records exist.
- A person can already unsubscribe, and can clear the guest contact tied to their privacy token. Before the CRM holds a richer profile, that person needs a way to see what is stored and to delete the member profile. Member delete is not in the app today.
- Owner and manager handle exports and deletes. Front desk can check someone in without downloading the list. A coach sees the players they teach and the skill ratings, and does not get the marketing file.
- A Playtomic email is personal data used to match a visit. It is a marketing contact when Playtomic says they accept commercial messages, or when they opt in at the club.

SMS consent, email consent, quiet hours, retention, and member deletion should be checked with a Florida attorney before the first campaign and before the richer profile is turned on. The admin manual already asks the club to have an attorney look at Florida breach-notice rules. This plan does not interpret those rules.

## What to build first

The first slice helps the desk and leaves the current tables in place.

1. One player page that joins the member, the player login, guest visits, bookings, check-ins, the Playtomic player link, and whether marketing consent is on.
2. Fields someone types: sport, a self-set skill, an optional coach skill, optional Playtomic level and DUPR as typed values, and an optional renewal date.
3. A lead list with the stages above. Staff move people by hand. A waitlist import or a new guest can start a lead. Becoming a lead does not opt anyone into marketing.
4. Tags staff apply by hand: beginner, evening, lapsed, renewal due.
5. Notes and a simple task.
6. CSV export of those fields for owner and manager, and a waitlist CSV import that requires an explicit consent column.
7. A campaign that reuses the current marketing send, for everyone in a tag who is still opted in. The send is recorded, quiet hours apply, and SMS stays off until opt-out can be stored.

## Later

- Suggested tags from booking times, and from a gap you define.
- Usual partners from Playtomic bookings that list several people, then from local bookings if those store more than one player.
- Find-a-fourth suggestions, with the separate opt-in.
- A live rating from Playtomic or DUPR, with the player's agreement and within that service's terms.
- Automatic messages after a first visit, or near a renewal date staff typed, under the same consent and quiet-hour rules.
- Clinics and tournaments on the profile, once [tournaments.md](tournaments.md) stores entries.
- Lesson payments on the spend line, once lesson bookings exist. The line still shows only amounts the app recorded.
- The member opens their own page, downloads it, and deletes it. That extends today's privacy token, which clears the guest contact and the marketing value.

## Decisions for you

- Which sports this club offers.
- Who may read staff notes.
- Whether staff will type a renewal date, since the app has no paid-until date.
- The quiet-hour window, after the attorney review.
- A Florida attorney reviewing SMS, email, and privacy before the first campaign.
