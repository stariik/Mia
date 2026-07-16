# Deploying the Mia backend

Target: a €3.79/mo Hetzner CX22, HTTPS via Caddy, everything in Docker.
Start to finish this is about 30 minutes, most of it waiting.

Why a VPS and not Vercel/serverless: accounts live in a JSON file on disk and
the rate limiter counts in memory. Both need one long-lived instance. On
serverless the accounts vanish and the limiter resets on every cold start —
which is also the thing standing between you and a surprise API bill.

---

## 0. What you need first

- A domain (required — Let's Encrypt will not issue a certificate for a bare
  IP, and the app refuses plain HTTP in release builds).
- The two secret files from this laptop:
  - `web/google-service-account.json`
  - the API keys for your `.env`

---

## 1. Create the server

Hetzner Cloud → New project → Add server:
- Location: **Falkenstein** or **Helsinki** (closest to Georgia with good peering)
- Image: **Ubuntu 24.04**
- Type: **CX22** (2 vCPU, 4 GB) — €3.79/mo
- SSH key: add yours (skip the password option)

Note the IPv4 address.

## 2. Point the domain at it

At your registrar's DNS:

| Type | Name | Value |
|---|---|---|
| A | `api` (or `@`) | your server's IPv4 |

Wait for it to resolve before step 5 — Caddy's certificate request fails if the
name doesn't point at the box yet:

```bash
dig +short api.yourdomain.com     # must print your server IP
```

## 3. Install Docker

```bash
ssh root@YOUR_SERVER_IP
curl -fsSL https://get.docker.com | sh
```

## 4. Get the code and the secrets on the box

```bash
git clone YOUR_REPO_URL mia && cd mia/web
```

Then from **your laptop** (a new terminal, not the SSH session) copy the two
things git deliberately does not carry:

```bash
scp web/google-service-account.json root@YOUR_SERVER_IP:/root/mia/web/
scp web/.env root@YOUR_SERVER_IP:/root/mia/web/          # after you fill it in
```

Build `.env` from the template first:

```bash
cp web/.env.example web/.env
openssl rand -base64 32        # paste as JWT_SECRET
```

Fill in `DOMAIN`, `JWT_SECRET`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`.

## 5. Start it

```bash
cd /root/mia/web && docker compose up -d --build
```

Caddy gets the certificate on first boot. Give it ~30 seconds, then from
anywhere:

```bash
curl https://api.yourdomain.com/          # → the "Backend is running" page
curl https://api.yourdomain.com/api/chat  # → 401. 401 is correct: the guard works.
```

Open `https://api.yourdomain.com/privacy` in a browser — that URL is what Play
wants, so confirm it renders before you paste it into the Console.

## 6. Point the app at it

In `mobile/src/config/env.ts` set:

```ts
const PROD_API_BASE_URL = 'https://api.yourdomain.com';
```

Rebuild the AAB. Until this is set, release builds refuse to start a request —
that is deliberate, not a bug.

---

## Redeploying later

```bash
cd /root/mia/web && git pull && docker compose up -d --build
```

Accounts survive: `users.json` lives in the `mia-data` volume, not the image.

## Backups

Two things on that box are unrecoverable if lost:

```bash
docker run --rm -v mia_mia-data:/d -v $(pwd):/b alpine tar czf /b/users-backup.tgz /d
```

...and `google-service-account.json` (also only on your laptop right now — same
category as the upload keystore).

## If something breaks

```bash
docker compose logs -f app      # app errors
docker compose logs -f caddy    # certificate problems live here
```

Certificate failing? It is almost always DNS not resolving yet, or port 80
blocked. Both must be open — 80 is how the ACME challenge is answered even
though all real traffic is on 443.
