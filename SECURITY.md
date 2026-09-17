# Security Boundaries

## Local-only bridge

ChromeHelper binds to `127.0.0.1` only. It is intended to be called by the ChromeShare process running on the same PC, not directly by a phone or public network client.

Chrome DevTools Protocol is also expected to remain on `127.0.0.1:9222`. Do not expose port 9222 to a network.

## Remote access

Remote authentication and phone-to-PC transport belong to ChromeShare or the DeskFlux host. ChromeHelper does not provide remote authentication.

DeskFlux host defaults to `127.0.0.1`. To bind it to a non-local address, set both:

```powershell
$env:HOST = '0.0.0.0'
$env:DESKFLUX_SESSION_TOKEN = 'long-random-token'
```

Requests to the host API must then include:

```text
Authorization: Bearer <token>
```

Use HTTPS or an authenticated transport for traffic that leaves the local machine. Do not expose an unauthenticated host or Chrome CDP port to the public internet.

## Secrets

Do not commit session tokens, API keys, certificates, or local environment files. Use environment variables or an external secret store.
