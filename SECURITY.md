# Security Policy

## Supported Version

Security fixes are provided for the latest published beta release.

## Reporting A Vulnerability

Do not open a public issue containing credentials, tokens, account identifiers, private Worker URLs, or an exploitable vulnerability.

Use [GitHub private vulnerability reporting](https://github.com/giaaaacomo/SYNCIO/security/advisories/new) to report security issues. Include:

- the affected SYNCIO version;
- the component and route involved;
- reproduction steps with all secrets redacted;
- the expected and observed impact;
- any suggested mitigation.

You should receive an initial response within seven days. Please allow time for a fix and coordinated disclosure before publishing details.

## Deployment Boundary

SYNCIO is self-hosted. Each installation stores data in the user's own Cloudflare account. Maintainers cannot inspect or recover deployment secrets.

If a credential may have been exposed:

1. replace `SYNCIO_SETUP_TOKEN` and `SYNCIO_ENCRYPTION_KEY` in Cloudflare;
2. reconnect Stremio so the stored auth material is replaced;
3. revoke and reconnect Trakt inside Stremio when delegated authorization may be affected;
4. remove any leaked values from logs, issues, screenshots, and Git history.

Changing the encryption key makes existing encrypted values unreadable; reconnect accounts after rotating it.
