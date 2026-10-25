# Look and feel

Light and warm: a cream page, white cards, one deep-green accent. System fonts only (a serif for headings, the phone's own sans-serif for everything else), no web fonts and no extra libraries. All colors are tokens at the top of `src/app/globals.css`; change them there.

| Token | Color | Used for |
|---|---|---|
| `--cream` | `#faf6ee` | page background |
| `--paper` | `#ffffff` | cards, tab bar |
| `--soft` | `#fffcf6` | form fields, stat tiles |
| `--ink` / `--muted` | `#2a2520` / `#6a6155` | text |
| `--accent` | `#2f6b58` | buttons, links, the current page |
| `--field` | `#948a76` | form borders (3:1 or better, so fields are easy to see) |
| `--warn*` / `--bad*` | amber / brick | notes and problems |

Phone first: a tab bar at the bottom (Home, Income, Expenses, Supplies, Taxes, More), a top bar with all links on a computer, 44 px tap targets, 16 px text in fields (so iPhones don't zoom), entries drawn as cards instead of wide tables. The page is always light; it does not follow the phone's dark mode. Printing a page hides the menus and buttons.

`tests/design.test.cjs` checks the color contrast of the token pairs, so a color change that makes text hard to read fails the tests.
