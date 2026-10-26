# Brand (placeholder)

A deliberately neutral look so the templates render nicely out of the box. **Replace it with your own club's name, logo and colors.**

The BitPadel name and the file `logo-placeholder.svg` are placeholders for this kit. They are not your club's brand. See [`../TRADEMARKS.md`](../TRADEMARKS.md).

| Token | Hex | Use |
|---|---|---|
| Slate night | `#0F172A` | Background |
| Surface | `#1E293B` | Cards/sections |
| Text | `#F8FAFC` | Body text |
| Muted | `#94A3B8` | Secondary text |
| Court teal | `#14B8A6` | Primary/buttons |
| Ball lime | `#D9F99D` | Accent/links |

Font: Inter, then any system sans-serif.

Files: `logo-placeholder.svg`, `bitpadel.css`. These stay in the kit as the starting look for the docs and the reference app. Do not put them on a door or a website as if they were your club's logo.

## In the reference app

[`reference/club-box`](../reference/club-box) does not ask you to edit these files to recolor the club. An owner or manager opens **Admin → Branding** and sets:

- Club name and short name
- Logo and favicon (PNG, JPG, or SVG, up to 512 KB; a favicon may also be ICO)
- Primary, accent, background, and text colors, with a live preview and a contrast warning
- A font from the list on the form (fonts already on the computer)
- A contact line, footer text, and up to four links

Until that form is saved, the app says **Your club** and uses the table above. The name "BitPadel" is rejected. An SVG that contains that name, or a script, is rejected.

The app serves the colors as `/brand.css`. That file sets the same variables the club-box stylesheet already uses (`--bg`, `--surface`, `--text`, `--muted`, `--primary`, `--accent`, `--danger`, `--line`, `--font`), so the existing pages pick up the change. Booking, member pages, the kiosk, receipts, and email use the saved brand. The values live in the app's database. See the [admin manual](../docs/manuals/02-admin.md).
