# Chess match report

A small Czech-language website built with HTML, CSS, and vanilla JavaScript. No framework, build step, API key, or backend is required. The chess.cz API allows cross-origin browser requests.

## Run

From this directory:

```sh
python3 -m http.server 8000
```

Open **http://localhost:8000**. You can also open `index.html` directly: report preview uses a bundled copy of the template when local-file requests are blocked. Serving over HTTP is recommended so edits to `template.html` are loaded automatically. For deployment, upload `index.html`, `styles.css`, `app.js`, and `template.html` to a static web host (HTTPS recommended for clipboard support).

On HTTP/HTTPS, the application loads `template.html` and falls back to the bundled template if that request fails. For direct local-file use, update the `report-template` block in `index.html` as well if you customize the template layout.

## Workflow

1. The current calendar year is loaded automatically. The API's year is the **start** of the season; change it if you need an earlier season.
2. Search and select a region, competition, round, and either team in the scheduled match. Suggestions ignore accents and support multiple search words. Use arrow keys and Enter or click a suggestion.
3. Both rosters load automatically, preserving the schedule's home/away assignment. Set the number of boards, select players, and enter results in **home : away** order. Duplicate players within a team are rejected when creating the report.
4. Confirm the actual date, enter the venue and referee. The competition's group, when applicable, is included in its API-provided name. API placeholder dates such as 9.9.9999 are left blank. Check the competition manager's email, which is populated from `compManagerEmail`.
5. Preview the report, generated from the existing `template.html` with as many rows as selected boards and an automatically calculated total.

## Email options

- **Open new email:** opens the configured email client with recipient, subject, and a complete plain-text report. `mailto:` cannot reliably insert HTML. Some clients limit mailto URL length; use the other options for longer reports.
- **Copy formatted report:** copies HTML and plain text. Paste into an HTML-enabled email composer to retain the table.
- **Download draft (.eml):** downloads a UTF-8 multipart email containing both plain text and the template's HTML, with recipient, subject, and `X-Unsent: 1`. Opening as an editable draft depends on the mail client; some clients open .eml files as messages and require “Edit as new”.

The site prepares emails; sending happens in your email client. The current form is automatically saved in this browser's local storage and restored after a reload or reopening the page. Use **Vymazat formulář** at the top to clear both the form and saved draft. Changing an upstream selection clears dependent selections. API failures provide a retry button.
