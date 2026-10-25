# Emergency and life-safety procedures

The club must verify this page with the local authority having jurisdiction (AHJ), the fire marshal, the insurer, and an attorney before it is posted as the club's plan. This repository cannot know your address, occupancy, or hardware. Write those on the sheet that hangs in the building. Do not add them to git.

The reference app is not a life-safety system. `GET /api/health` reports `controlsEgress: false` and `controlsLifeSafety: false`. The kiosk says the same thing when the server is down, including with JavaScript disabled. The example relay rejects fire, lock, and egress commands.

## What staff say in every emergency

People leave without a phone, a card, a wallet, power, or this server. If an exit is blocked, treat that as the emergency. Call the fire marshal and the installer. Do not look in Admin for a release button. There is not one.

Fill these in on the posted copy, not in this file:

- Emergency number you were told to call: ______________
- Building address: ______________
- AED location: ______________
- Who to call at the club after the emergency number: ______________

The [pilot checklist](../02-pilot-checklist.md) already asks you to post an emergency action plan, the address for emergency services, the AED location, and a heat policy.

## Power failure

1. Help people leave. Exits that depend on power must be the ones your installer and AHJ approved (panic hardware, request-to-exit, fire release). This software is not that path.
2. Know which lock you have, from the installer, not from guesswork. A fail-secure lock stays locked without power. A fail-safe lock unlocks without power. The [hardware guide](../../reference/club-box/README.md#compatible-door-hardware) states that the choice is a code decision.
3. If a battery backup is supposed to keep the entry side up, that is the supply the installer sized. The app does not report battery state. **Not yet implemented:** power or battery monitoring.
4. The kiosk and the booking page stop when the computer stops. Unpaid holds stay until the process starts and the sweep runs. Nobody can complete a new Lightning hold while the server is down.
5. When power returns, open `/api/health`, try one entry pulse, and walk an exit again.

## Fire alarm

1. Follow the posted evacuation plan and the fire marshal's instructions.
2. Door release on alarm is a circuit this process cannot reach. A magnetic lock that is legal in your building is released by that circuit and by request-to-exit, not by club-box.
3. Do not silence an alarm from the booking admin. **Not yet implemented:** any alarm integration.
4. Do not prop a required fire door in a way your AHJ forbids. This manual will not invent a hold-open rule.
5. After the building is cleared by the people who have that authority, a manager can restart the app. A missed entry pulse is not delivered later.

## Medical emergency

1. Call the emergency number on the posted sheet.
2. Send someone to meet responders at the entrance you were told to use.
3. Use the AED only if you were trained and your club's policy says to. **Not yet implemented:** medical records, incident forms, or AED tracking in the app.
4. The desk list is not a patient log. Do not put health details in the access log or the maintenance log.
5. Afterward, write a factual note for the insurer using the club's own form. The [event run-of-show](../../templates/event-run-of-show.md) is for planned events, not for medical charts.

## Evacuation

1. Announce the evacuation the way your posted plan says.
2. Leave. Do not stop to check members out in the app. Checkout is a visit record, not a headcount for fire. The desk can be wrong if someone never unlocked through the kiosk.
3. Take a paper headcount if your plan says the desk keeps one. **Not yet implemented:** an evacuation mode or a muster screen.
4. Meet at the place the plan names.
5. Re-enter only when the AHJ or the person your plan names says so.
6. When you are open again, check out stale visits or let `CHECKIN_STALE_MINUTES` clear them, and confirm the exit still works.

## Who must sign the local plan

Have these people review the posted plan before you rely on it:

- The AHJ and the fire marshal, for exits, occupancy, maglocks, and alarm release.
- Your insurer, including any question about unstaffed hours and wallet or card entry. The pilot checklist already lists that question.
- An attorney, for waivers and for anything you tell the public.
- The licensed installer, for fail-safe versus fail-secure and for battery backup.

Staff training for this page is the exit walk in the [training guide](07-staff-training.md).
