# Security Policy

ZwiftBikes is a small hobby project. There's no user authentication and
no sensitive user data - rider profile and "garage" data are stored client-side
in the browser only. Still, if you find a security issue (e.g. XSS, dependency
vulnerability with real impact, etc.), please report it responsibly.

The API is public and read-only. Its query parameters are strictly validated
(invalid values return a 400), cross-site browser requests to the REST
endpoints are rejected, and the expensive endpoints (`/api/recommend/**`,
`/api/mcp`) carry best-effort per-IP rate limiting - see
`server/middleware/` and `server/utils/apiQuerySchemas.ts`.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security reports.

Instead, use
[GitHub's private vulnerability reporting](https://github.com/kjellrg/zwift-bikes/security/advisories/new)
for this repository. This sends the report privately to the maintainer
without disclosing it publicly.

This is a side project maintained in spare time, so there's no guaranteed
response time, but reports will be looked at and fixes released as soon as
reasonably possible.

## Non-security bugs

For ordinary bugs, or a frame/wheel/route number that looks wrong, use the
**Report an issue** link in the site footer (or
[zwiftbikes.com/report](https://zwiftbikes.com/report)) - it prefills the
right issue form for you. A GitHub issue is public, which is fine for an
ordinary bug; if you'd rather not post one, the same form can send the report
by email instead - **Email it instead** opens your mail app with the address
(`bugs [at] zwiftbikes.com`) already filled in - and that is read privately.
Your email address is never published in an issue, and your name only appears
there if you ask to be credited. Only security issues need the private route
above.

## Supported Versions

There are no released versions - the app runs from the latest commit on the
`main` branch. Only the current `main` branch is supported; please make sure
an issue still reproduces there before reporting.
