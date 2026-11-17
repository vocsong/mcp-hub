# Security policy

## Reporting a vulnerability

Report security issues privately through GitHub: open this repository's **Security** tab and
choose **Report a vulnerability**
([direct link](https://github.com/vocsong/mcp-hub/security/advisories/new)). Please do not open
a public issue, discussion or pull request for a suspected vulnerability.

Include what you can of:

- where you saw it: `mcp.vocs.io`, the staging entry, or a commit of this repository;
- the component: login, the account catalog, MCP authorization, the dashboard or the mock;
- steps to reproduce, ideally the smallest example, with what you expected and what happened;
- the impact you believe it has.

Do not send real provider keys, tokens, session cookies or anyone else's data. Test only with
your own account; no denial-of-service, load testing, spam or social engineering, and no paid
provider requests on someone else's behalf.

## What happens next

You get an acknowledgement through the advisory, usually within a few days, and updates there
while it is investigated. The advisory is published with the fix and credits you unless you ask
otherwise. The security model is described in [docs/SECURITY.md](docs/SECURITY.md).
