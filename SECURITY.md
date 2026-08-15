# Security Policy

ZwiftBikes is a small hobby project. There's no user authentication and
no sensitive user data - rider profile and "garage" data are stored client-side
in the browser only. Still, if you find a security issue (e.g. XSS, dependency
vulnerability with real impact, etc.), please report it responsibly.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security reports.

Instead, use
[GitHub's private vulnerability reporting](https://github.com/kjellrg/zwift-bikes/security/advisories/new)
for this repository. This sends the report privately to the maintainer
without disclosing it publicly.

This is a side project maintained in spare time, so there's no guaranteed
response time, but reports will be looked at and fixes released as soon as
reasonably possible.

## Supported Versions

There are no released versions - the app runs from the latest commit on the
`main` branch. Only the current `main` branch is supported; please make sure
an issue still reproduces there before reporting.
