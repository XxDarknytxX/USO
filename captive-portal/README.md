# Captive Portal (Ruijie Custom HTML)

This is the bundle that gets uploaded to the Ruijie Wi-Fi controller as
the custom captive-portal page. It runs **on the controller, not on our
server** — it just redirects the user's browser to the USO Portal with
the Ruijie-issued `sessionId` and `clientMac` as query params.

## Before uploading to Ruijie

Replace the placeholder `PORTAL_HOSTNAME_HERE` in these two files with
your actual public hostname (e.g. `portal.example.com`):

- `index.html` — used in the redirect target (3 occurrences)
- `loadConfig.json` — `post_url` Ruijie returns to after auth

Quick sed for both files:

```bash
sed -i '' 's/PORTAL_HOSTNAME_HERE/portal.example.com/g' index.html loadConfig.json   # macOS
sed -i    's/PORTAL_HOSTNAME_HERE/portal.example.com/g' index.html loadConfig.json   # Linux
```

Then zip the directory and upload via the Ruijie Cloud dashboard:

```bash
zip -r customHtml.zip . -x "README.md" "Archive.zip" "*.DS_Store"
```

## Files

| File | Purpose |
|------|---------|
| `index.html` | Entry point. Reads `sessionId`/`clientMac` from URL, redirects to USO Portal. |
| `loadConfig.json` | Ruijie configuration — `post_url` is where the controller redirects after a successful voucher auth (`/status` on the portal). |
| `css/index.css` | Page styling (you can tweak colors/fonts here). |
| `js/index.js` | Page logic — usually left untouched. |
| `js/language.js` | Multi-language text. |
| `img/` | Portal logo + images. |

> **Don't rename or delete files** beyond what's listed — Ruijie expects
> a specific structure.
