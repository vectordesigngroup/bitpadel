# NFC card programming

This is the procedure for personalizing an **NTAG 424 DNA** access card for the club-box reference app. It is an example procedure, not a certification, and not a product endorsement. A MIFARE DESFire EV2 or EV3 card can be an access credential too. The command below personalizes NTAG 424 DNA. DESFire personalization stays on a tool that speaks full EV2 to that card.

Code in the app is AGPL-3.0-only. This document is CC BY-SA, with the rest of the playbooks.

## What you need

- NTAG 424 DNA cards. Factory keys are 16 zero bytes. Change them before the card is used as a credential.
- A PC/SC reader/writer. ACR122U-class and ACR1252-class readers are examples of that category. They are not certified by this project.
- The `pcscd` service and the optional `pcsclite` Node module on the machine that runs the programmer. The club server does not need either.
- A club master key and a club SDM meta-read key, each 16 bytes of hex, created locally.

## Keys

Diversification follows NXP AN10922 (AES-128). The input for an NTAG 424 key is:

`UID (7 bytes) || NDEF AID D2760000850101 || key number (1 byte) || system id`

The system id defaults to `club-box` and can be `NFC_SYSTEM_ID` (1–16 bytes). The DESFire example uses AID `F54201` plus the key number and the same system id. That AID is an example, not a certified product id.

| Slot | Contents |
|---|---|
| 0 | Application master. Diversified. Changed last, while the session is still authenticated with the transport key. |
| 1 | SDM counter retrieval. Diversified. |
| 2 | SDM meta read. **Not** diversified. One club-wide key, because the UID is inside the encrypted PICC data and the server cannot diversify before decrypting it (AN12196). |
| 3 | SDM file read. Diversified. The SUN CMAC uses this key. |
| 4 | Diversified so it is not left at the factory zeros. |

If the meta-read key leaks, UIDs and counters in captured taps can be decrypted. Forging a tap still needs the per-card file-read key.

Store keys in the environment or in a local JSON file:

```json
{
  "masterKey": "",
  "metaReadKey": "",
  "systemId": "club-box"
}
```

Point `NFC_KEYS_FILE` at that file. The sample names `nfc-keys.json` and `*-nfc-keys.json` are gitignored. Do not commit keys. Keep an offline backup of the master key. A lost master key means you cannot diversify replacements for cards you already issued. The server needs both keys or it refuses cryptographic taps.

`NFC_TRANSPORT_KEY` is the key currently on slot 0 before programming. Leave it empty when the card is still on the factory zeros.

## SUN URL

The NDEF file is a URL record:

`{PUBLIC_BASE_URL}/api/access/tap?area={area}&e={32 zero hex chars}&c={16 zero hex chars}`

The card mirrors encrypted PICC data over `e` and the truncated CMAC over `c`. The CMAC input offset equals the CMAC offset, so the CMAC covers an empty input, matching the AN12196 example where those offsets are equal. Keep the public URL short enough for a short NDEF record (the payload must be 255 bytes or less).

SDM options mirror the UID and the counter, with ASCII encoding. File settings use read-free access, meta-read key slot 2, file-read key slot 3, and counter-retrieval key slot 1.

## Program a card

From `reference/club-box`, with keys in the environment or `--keys`:

```bash
npm run card:program -- --dry-run --uid 04DE5F1EACC040 --area lounge
```

Dry-run uses an in-memory card, prints the APDUs, and does not enroll anything. Those APDUs are encrypted command material. They are not the club keys, and the log should still be treated as sensitive.

On a machine with a reader:

```bash
npm run card:program -- --uid 04DE5F1EACC040 --area lounge --member mem_… --server http://127.0.0.1:3000
```

The real reader path loads `pcsclite` only when you are not in `--dry-run`. The steps are:

1. Select the NDEF application (`D2760000850101`).
2. EV2 first authentication with the transport key (AN12196).
3. Change keys 1, 2, 3, 4, then 0. Slot 2 receives the raw meta-read key. The others are diversified. Key version is `01`.
4. Write the NDEF URL with the placeholders.
5. Change the NDEF file settings to turn on SDM.
6. Read the file back and compare it with the bytes just written.
7. Unless you passed `--skip-register`, POST the UID to `/api/admin/members/:id/cards` with scheme `ntag424-sun`. That call needs `ADMIN_TOKEN`.

Then tap the card. The phone or `npm run reader:bridge` opens the URL. The bridge only reads the NDEF URL and requests it. Keys stay on the server.

Enroll the same UID in admin if you skipped registration. Revoke or mark lost from the member's card buttons. To replace a card, mark the old one lost, program a new UID, and enroll that UID. Re-enrolling a lost or revoked UID reactivates it and resets the stored counter. An active UID on another member is refused.

## Desk reader

`npm run reader:bridge` waits for a PC/SC card, reads the NDEF file, and GETs the SUN URL. Use it when the kiosk computer has the reader and the club server holds the keys.

## Troubleshooting

| What you see | What to check |
|---|---|
| Card rejected an APDU | The transport key does not match slot 0. Set `NFC_TRANSPORT_KEY` to the current key. Factory cards use 16 zero bytes. |
| URL too long | Shorten `PUBLIC_BASE_URL` or the area id. The NDEF payload has to fit in 255 bytes. |
| 503 card verification is not configured | The server is missing the master key or the meta-read key. |
| 401 card authentication failed | The programmed keys and the server keys differ, or the URL placeholders were overwritten by hand. |
| 403 counter was already used | The tap was replayed, or the card's counter is behind the value already stored. A lost-and-reissued card resets the stored counter. |
| `pcsclite` fails to load | Install pcscd and the optional native module on the programmer machine. The server image does not include them. |
| UID-only tap returns 403 | That is the default. `NFC_UID_MODE=insecure-dev` is the only switch, and it is clonable. |

## Security notes

- Never commit keys, APDU logs from a real card, or a key backup into this repository.
- Keep the master key and the meta-read key offline as well as on the server. The meta-read key is club-wide.
- UID-only and NTAG215-style tags are clonable. Do not use them for a door.
- A Bolt Card is a Lightning payment card that can use the same chip family. Payment and door access are different jobs. Do not load a door key onto a payment card, or pay from a door card.
- Tests in this repo use published AN10922 and AN12196 vectors, including the all-zero SUN example. Those values are documentation vectors, not a club's keys.
