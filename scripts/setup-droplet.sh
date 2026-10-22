#!/usr/bin/env bash
# One-time setup on an Ubuntu/Debian droplet. Safe to re-run: it only changes what's missing.
#   sudo bash scripts/setup-droplet.sh           # interactive
#   sudo bash scripts/setup-droplet.sh --check   # report only, change nothing
set -euo pipefail
cd "$(dirname "$0")/.."

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*"; exit 1; }
ask() { # ask "question" default → echoes answer
  local reply
  read -r -p "  $1 [${2}]: " reply </dev/tty || true
  echo "${reply:-$2}"
}
yes_no() { [[ "$(ask "$1 (y/n)" "${2:-y}")" =~ ^[Yy] ]]; }

[[ $EUID -eq 0 ]] || fail "Run with sudo: sudo bash scripts/setup-droplet.sh"
[[ -f /etc/os-release ]] && . /etc/os-release
[[ "${ID:-}" == "ubuntu" || "${ID:-}" == "debian" || "${ID_LIKE:-}" == *debian* ]] || warn "Tested on Ubuntu/Debian; you're on ${PRETTY_NAME:-unknown}."

# ---------------------------------------------------------------- machine
bold "1. This droplet"
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
SWAP_MB=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
DISK_FREE_GB=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
CPUS=$(nproc)
echo "  RAM ${MEM_MB} MB · swap ${SWAP_MB} MB · ${CPUS} CPU · ${DISK_FREE_GB} GB disk free"
[[ $DISK_FREE_GB -ge 6 ]] && ok "Disk: enough (needs ~5 GB for images + build cache)" || warn "Disk: only ${DISK_FREE_GB} GB free; the first build needs ~5 GB. Free space or resize the droplet."
if (( MEM_MB + SWAP_MB < 2000 )); then
  warn "RAM + swap is under 2 GB: building the app can run out of memory."
  if [[ $CHECK_ONLY -eq 0 ]] && yes_no "Add a 2 GB swap file (recommended; uses disk, not your bill)?"; then
    fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    ok "2 GB swap added"
  fi
else
  ok "Memory: enough to build and run (~600 MB used when running)"
fi

# ---------------------------------------------------------------- docker
bold "2. Docker"
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  ok "$(docker --version | cut -d, -f1), $(docker compose version --short 2>/dev/null || echo compose)"
else
  warn "Docker with the compose plugin isn't installed."
  [[ $CHECK_ONLY -eq 1 ]] || {
    yes_no "Install Docker now with Docker's official script (get.docker.com)?" || fail "Docker is required."
    curl -fsSL https://get.docker.com | sh
    ok "Docker installed"
  }
fi

# ---------------------------------------------------------------- ports
bold "3. Ports 80/443 (for HTTPS)"
PORT_USERS=$(ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null | grep -v docker-proxy | sed -E 's/.*users:\(\("([^"]+)".*/\1/' | sort -u | tr '\n' ' ' || true)
if [[ -z "$PORT_USERS" ]]; then
  USE_CADDY=1
  ok "Free (or used by Rave Run's own Caddy): Caddy will serve HTTPS with a free certificate"
else
  USE_CADDY=0
  warn "Already used by: ${PORT_USERS}. Rave Run will listen on 127.0.0.1:3000 and you'll point your existing web server at it (instructions at the end)."
fi

[[ $CHECK_ONLY -eq 1 ]] && { bold "Check only: nothing changed."; exit 0; }

# ---------------------------------------------------------------- .env
bold "4. Settings (.env)"
PUBLIC_IP=$(curl -fsS -m 3 http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address 2>/dev/null || curl -fsS -m 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
set_env() { # set_env KEY VALUE: replace the KEY= line (or append), value written verbatim
  local key=$1 val=$2
  if grep -q "^${key}=" .env; then
    awk -v k="$key" -v v="$val" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' .env > .env.tmp && mv .env.tmp .env
  else
    echo "${key}=${val}" >> .env
  fi
}
get_env() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- || true; }

[[ -f .env ]] || { cp .env.example .env; chmod 600 .env; ok "Created .env from .env.example"; }
[[ -n "$(get_env POSTGRES_PASSWORD)" && "$(get_env POSTGRES_PASSWORD)" != change-me* ]] || { set_env POSTGRES_PASSWORD "$(openssl rand -hex 24)"; ok "Generated database password"; }
[[ -n "$(get_env SESSION_SECRET)" && "$(get_env SESSION_SECRET)" != change-me* ]] || { set_env SESSION_SECRET "$(openssl rand -hex 32)"; ok "Generated session secret"; }
if [[ -z "$(get_env APP_PASSWORD)" || "$(get_env APP_PASSWORD)" == change-me* ]]; then
  PW=$(ask "App login password (blank = generate one)" "")
  [[ -n "$PW" ]] || PW=$(openssl rand -base64 18 | tr -d '/+=' )
  [[ "$PW" =~ [[:space:]\"\'\$\`\\] ]] && fail "Please avoid spaces, quotes, \$, \` and \\ in the password."
  set_env APP_PASSWORD "$PW"
  ok "App password set (shown at the end)"
fi
if [[ $USE_CADDY -eq 1 ]]; then
  CUR=$(get_env DOMAIN)
  DEF=${CUR:-}
  [[ -z "$DEF" || "$DEF" == raverun.example.com ]] && DEF="${PUBLIC_IP//./-}.sslip.io"
  echo "  Your own domain (e.g. raverun.yourname.com, with an A record → ${PUBLIC_IP}), or keep the free"
  echo "  ${PUBLIC_IP//./-}.sslip.io address, which works with no DNS setup."
  DOMAIN=$(ask "Address for the app" "$DEF")
  set_env DOMAIN "$DOMAIN"
  if [[ "$DOMAIN" != *.sslip.io ]]; then
    RESOLVED=$(getent ahostsv4 "$DOMAIN" | awk '{print $1; exit}' || true)
    [[ "$RESOLVED" == "$PUBLIC_IP" ]] && ok "DNS: $DOMAIN → $PUBLIC_IP" || warn "DNS: $DOMAIN points to '${RESOLVED:-nothing}', not $PUBLIC_IP. HTTPS will fail until the A record is fixed."
  fi
fi
if [[ -z "$(get_env SERPAPI_KEY)" ]]; then
  KEY=$(ask "SerpApi key for real flight/hotel prices (blank = add later in .env)" "")
  [[ -n "$KEY" ]] && set_env SERPAPI_KEY "$KEY"
fi
chmod 600 .env

# ---------------------------------------------------------------- firewall
if command -v ufw >/dev/null && ufw status | grep -q "Status: active" && [[ $USE_CADDY -eq 1 ]]; then
  ufw status | grep -qE '^(80|443)/tcp.*ALLOW' || { yes_no "Firewall (ufw) is on. Allow ports 80 and 443?" && ufw allow 80/tcp && ufw allow 443/tcp; }
fi

# ---------------------------------------------------------------- build + start
bold "5. Build and start (first time: 5–15 minutes)"
PROFILE=()
[[ $USE_CADDY -eq 1 ]] && PROFILE=(--profile caddy)
export COMPOSE_PARALLEL_LIMIT=1 # build one image at a time to save memory
docker compose "${PROFILE[@]}" build || fail "Build failed. Copy the error above and send it over."
docker compose "${PROFILE[@]}" up -d || fail "Start failed: docker compose logs"

printf '  Waiting for the database setup'
for _ in $(seq 1 60); do
  docker compose logs worker 2>/dev/null | grep -q "Worker up" && break
  printf '.'; sleep 3
done; echo
docker compose logs worker 2>/dev/null | grep -q "Worker up" && ok "Worker running (migrations + seed done)" || fail "Worker didn't start: docker compose logs worker"
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null http://127.0.0.1:3000/login && break; sleep 2
done
curl -fsS -o /dev/null http://127.0.0.1:3000/login && ok "Web app answering on 127.0.0.1:3000" || fail "Web app not answering: docker compose logs web"

# ---------------------------------------------------------------- done
bold "Done"
if [[ $USE_CADDY -eq 1 ]]; then
  echo "  Open:      https://$(get_env DOMAIN)   (the certificate can take a minute the first time)"
else
  cat <<NGINX
  Point your existing web server at http://127.0.0.1:3000. For nginx, add:

    server {
      server_name raverun.yourdomain.com;
      location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto \$scheme; }
    }

  then: sudo nginx -t && sudo systemctl reload nginx (and add HTTPS with certbot).
NGINX
fi
echo "  Password:  $(get_env APP_PASSWORD)"
echo "  Check now: docker compose exec worker npm run worker:once   (real prices need SERPAPI_KEY)"
echo "  Update:    sudo bash scripts/update.sh"
