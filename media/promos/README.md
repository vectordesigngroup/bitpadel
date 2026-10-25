# BitPadel promo videos

These are short motion-graphics promos for **BitPadel**, the open-source "Bitcoin padel club in a box" kit
(https://github.com/vectordesigngroup/bitpadel). Each video comes in two sizes: landscape 16:9 (1920x1080) and vertical 9:16 (1080x1920).
All files are H.264/AAC MP4 at 30 fps and run about 30 seconds.

| # | Video | 16:9 | 9:16 | Poster |
|---|-------|------|------|--------|
| 1 | **Mission**: padel + Bitcoin adoption. Uses "a different way to 'mine' Bitcoin" and labels it on screen as a metaphor | `bitpadel-01-mission-16x9.mp4` | `bitpadel-01-mission-9x16.mp4` | `bitpadel-01-mission-poster.png` |
| 2 | **What's in the kit**: playbooks, templates, Lightning court booking, LNURL-auth / NFC entry and check-in, reference app | `bitpadel-02-kit-16x9.mp4` | `bitpadel-02-kit-9x16.mp4` | `bitpadel-02-kit-poster.png` |
| 3 | **Call to action**: club founders, coaches, Bitcoin educators and Lightning devs. Ends on the GitHub URL | `bitpadel-03-cta-16x9.mp4` | `bitpadel-03-cta-9x16.mp4` | `bitpadel-03-cta-poster.png` |

Every poster PNG also has a vertical version (`*-poster-9x16.png`).

Notes
- Colors and type follow `brand/`: Slate night, Court teal, Ball lime and Inter. The logo is redrawn from `brand/logo-placeholder.svg`. Under TRADEMARKS.md the BitPadel name and logo are not licensed to other clubs.
- The videos make no claims about mining, earnings, returns or investment, show no prices, and contain no club-specific plans.
- Music is an instrumental bed generated with ElevenLabs Music for this project. The SFX (whoosh, pop, tick, chime, hit) were synthesized in code.
- The Remotion source lives on the build box at `/workspace/bitpadel-promo-src` (`src/Mission.tsx`, `src/Kit.tsx`, `src/Cta.tsx`, `src/ui.tsx`).
  To re-render: `npx remotion render src/index.tsx Mission-16x9 out.mp4 --codec h264`. The compositions are `{Mission,Kit,Cta}-{16x9,9x16}`.
