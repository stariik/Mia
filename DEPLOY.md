# Deploying the Mia backend

Server: Hetzner CX22 · Domain: `api.miavoice.online` · HTTPS via Caddy · all in Docker.
~20 minutes, most of it waiting on a build.

Why a VPS and not Vercel/serverless: accounts live in a JSON file on disk and the
rate limiter counts in memory. Both need one long-lived instance. On serverless
the accounts vanish and the limiter resets on every cold start — and that limiter
is what stands between you and a runaway API bill.

---

## Before you start

- `nslookup api.miavoice.online` must print your Hetzner IP. If it doesn't, wait —
  Caddy's certificate request fails if the name doesn't resolve yet, and that is
  the #1 confusing first-deploy error.
- Hetzner firewall allows **22, 80, 443**. Port 80 must be open even though all
  real traffic is 443 — it's how Let's Encrypt proves you own the domain.

---

## 1. Get on the box

```bash
ssh root@YOUR_SERVER_IP
```

## 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
```

## 3. Let the server read the private repo

The repo is private, so a plain `git clone` will fail. Give the server its own
read-only key. On the **server**:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github -N ""
cat ~/.ssh/github.pub
```

Copy that line → GitHub → **stariik/voice-ai → Settings → Deploy keys → Add deploy
key** → paste → **leave "Allow write access" UNCHECKED** (the server only ever
needs to read; a leaked write key could rewrite your app).

Then tell git to use it:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/github
  IdentitiesOnly yes
EOF

git clone git@github.com:stariik/voice-ai.git /root/mia
```

Say `yes` to the host-key prompt.

## 4. Copy the two secrets from your laptop

These are deliberately not in git. From **PowerShell on your laptop**, in the repo
folder (not the SSH session):

```powershell
scp web/.env root@YOUR_SERVER_IP:/root/mia/web/.env
scp web/google-service-account.json root@YOUR_SERVER_IP:/root/mia/web/
```

`web/.env` is already filled in — every API key, a freshly generated `JWT_SECRET`,
and `DOMAIN=api.miavoice.online`. Nothing to edit.

## 5. Start it

```bash
cd /root/mia/web && docker compose up -d --build
```

First build takes a few minutes. Caddy fetches the certificate on boot; give it
~30 seconds after the containers are up.

## 6. Verify

```bash
curl https://api.miavoice.online/
curl https://api.miavoice.online/api/chat
```

- First → the "Backend is running" page.
- Second → **`401`. A 401 is the correct answer** — it means the API is live and
  the auth guard is working. Anything else (000, 502, cert error) means something
  is wrong; see below.

Then open **https://api.miavoice.online/privacy** in a browser. That exact URL goes
into Play Console, so confirm it renders and shows a padlock before you paste it.

---

## Redeploying later

```bash
cd /root/mia/web && git pull && docker compose up -d --build
```

Accounts survive: `users.json` lives in the `mia-data` volume, not the image.

## Back up

Two things exist in only one place:

```bash
# accounts
docker run --rm -v web_mia-data:/d -v $(pwd):/b alpine tar czf /b/users-backup.tgz /d
```

...and `google-service-account.json`, which is only on your laptop and this box.
Same category as the upload keystore: no recovery if lost.

## When it breaks

```bash
docker compose logs -f app      # app errors
docker compose logs -f caddy    # certificate problems live here
docker compose ps               # is anything actually running?
```

**Certificate won't issue** → almost always DNS not resolved yet, or port 80
blocked. Check `nslookup api.miavoice.online` and the Hetzner firewall.

**`502 Bad Gateway`** → Caddy is up but the app isn't. `docker compose logs app`.

**`curl` hangs / connection refused** → firewall. 80 and 443 both need to be open.
