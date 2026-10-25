#!/usr/bin/env bash
# Déploiement déclenché par GitHub Actions (.github/workflows/deploy.yml).
#
# Installé hors du dépôt, en /opt/autorisation-conduite/deployer.sh, et imposé à la clé SSH
# de déploiement dans ~/.ssh/authorized_keys :
#   command="/opt/autorisation-conduite/deployer.sh",restrict ssh-ed25519 AAAA… gh-actions autorisation-conduite
# La clé ne peut donc rien faire d'autre que lancer ce script. Le seul argument accepté
# est l'empreinte du commit testé par la CI : on ne déploie que ce qui est déjà sur main.
set -euo pipefail

DEPOT=/opt/autorisation-conduite/depot
VERSION="${SSH_ORIGINAL_COMMAND:-}"
if ! [[ "$VERSION" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage : empreinte complète du commit à déployer" >&2
  exit 2
fi

cd "$DEPOT"
git fetch --quiet origin main
if [ "$(git rev-parse origin/main)" != "$VERSION" ]; then
  echo "main a avancé depuis la version testée ($VERSION) : déploiement laissé au passage suivant."
  exit 0
fi
git reset --quiet --hard "$VERSION"

export VERSION="${VERSION:0:8}"
docker compose -f infra/docker-compose.yml up -d --build --wait --wait-timeout 120
docker image prune -f --filter label=com.docker.compose.project=autorisation_conduite >/dev/null
echo "Déployé : $VERSION"
