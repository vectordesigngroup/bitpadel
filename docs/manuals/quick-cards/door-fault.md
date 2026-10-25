# Quick card: door fault

Print this page. People must be able to leave with the server off. This app cannot lock a door and cannot run a fire release.

## On the kiosk

| Line | Do this |
|---|---|
| Entry controller did not respond. | Entry pulse failed. Use the fob, PIN, or staff to let them in. Tell a manager. The app will not retry. |
| Access server unreachable. | Server or network is down. Same fallback. Exits still do not use this screen. |
| That area is closed right now. | Outside the hours a manager set. Do not override from the desk. |
| This wallet is not enrolled. / This card is not enrolled. | Credential was never added, or the key was revoked. A manager enrolls them. |
| Membership is not active. | A manager decides whether to restore the member. |
| That card is not active. | Lost or revoked. Use the [lost-card card](lost-card.md). |

## Manager checks

1. Relay process is running and is not on the public internet.
2. `DOOR_HTTP_URL` ends at `/pulse` on the example relay.
3. `DOOR_HTTP_TOKEN` matches the relay token.
4. One new unlock. A failed pulse is an access-log row `door-failed`.
5. If people cannot leave, stop debugging software. Use the exit hardware and call the installer and the fire marshal. See the [emergency manual](../08-emergency.md).

The example relay refuses lock, fire, and egress commands on purpose.
