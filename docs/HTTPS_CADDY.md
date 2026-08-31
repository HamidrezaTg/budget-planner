# HTTPS With Caddy

The Budget Planner server speaks HTTP directly. Put Caddy in front of it when
the server will be reachable from the public internet or an untrusted network.
Caddy obtains and renews a TLS certificate automatically for a domain that
resolves to the server.

## 1. Point DNS at the server

Create an `A` or `AAAA` record for a hostname such as `budget.example.com`.
Allow inbound TCP ports `80` and `443` through the firewall. Caddy uses port
`80` for the ACME challenge and redirects HTTP traffic to HTTPS.

## 2. Bind Budget Planner locally

Edit `/etc/default/budget-planner`:

```ini
BIND_IP=127.0.0.1
SECURE_COOKIE=1
TRUST_PROXY=1
```

`BIND_IP` keeps the unencrypted server port off the LAN. `SECURE_COOKIE` marks
the session cookie as HTTPS-only, and `TRUST_PROXY` lets the server use the
client IP forwarded by Caddy for rate limiting. The packaged systemd service
loads this file automatically.

Restart the server after changing the settings:

```bash
sudo systemctl restart budget-planner
```

## 3. Configure Caddy

Add this site to `/etc/caddy/Caddyfile`:

```caddyfile
budget.example.com {
    reverse_proxy 127.0.0.1:2026
}
```

Then validate and reload Caddy:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Open `https://budget.example.com` and create or use your Budget Planner
account. Verify the health endpoint with:

```bash
curl -fsS https://budget.example.com/healthz
```

## Private networks

For a LAN-only deployment, keep the server on plain HTTP or use a private VPN
such as Tailscale. For a private hostname without a publicly trusted DNS
record, configure Caddy's internal CA deliberately and install that CA on each
client; otherwise browsers and native clients will reject the certificate.

Do not expose port `2026` directly once Caddy is serving the site. Back up the
Budget Planner data directory separately; Caddy only handles transport and
does not protect or store budget data.
