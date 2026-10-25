#!/usr/bin/env bash
# Mise en service (ou réinstallation) sur le VPS, à lancer depuis un poste qui a l'accès SSH
# au VPS et la CLI GitHub (gh) connectée :
#
#   infra/installer-vps.sh <e-mail(s) des gestionnaires> [hôte-ssh]
#   ex. : infra/installer-vps.sh rtpa.dt09@croix-rouge.fr,prenom.nom@croix-rouge.fr
#
# 1. Clone le dépôt dans /opt/autorisation-conduite/depot et installe deployer.sh.
# 2. Écrit infra/.env (une seule fois) : jeton de service tiré au sort SUR LE VPS, recopié dans
#    /opt/gestion-dps/backend/.env (INTEGRATION_AUTORISATION_CONDUITE_TOKEN) ; SMTP repris de Stock Secours.
#    Le jeton ne quitte jamais le VPS.
# 3. Nouvelle clé de déploiement, limitée dans authorized_keys au seul script deployer.sh,
#    rangée dans les secrets GitHub (copie locale effacée).
# 4. Arrête l'ancien conteneur nginx et lance le premier déploiement.
set -euo pipefail

GESTIONNAIRES=${1:?Usage : $0 <e-mail(s) des gestionnaires, séparés par des virgules> [hôte-ssh]}
HOTE=${2:-gestion-dps-vps}
DEPOT_GH=Cocosg09/generateur-autorisation-conduite-CRF
BASE=/opt/autorisation-conduite

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
ssh_param() { ssh -G "$HOTE" | awk -v cle="$1" '$1 == cle { print $2; exit }'; }
VPS_HOST=$(ssh_param hostname)
VPS_USER=$(ssh_param user)
VPS_PORT=$(ssh_param port)

echo "→ Dépôt, script de déploiement et réglages sur $VPS_USER@$VPS_HOST:$VPS_PORT"
ssh "$HOTE" GESTIONNAIRES="$GESTIONNAIRES" bash -s <<'DISTANT'
set -euo pipefail
B=/opt/autorisation-conduite
G=/opt/gestion-dps/backend/.env
[ -d "$B/depot/.git" ] || git clone -q https://github.com/Cocosg09/generateur-autorisation-conduite-CRF.git "$B/depot"
git -C "$B/depot" fetch -q origin main && git -C "$B/depot" reset -q --hard origin/main
install -m 755 "$B/depot/infra/deployer.sh" "$B/deployer.sh"

ENVF="$B/depot/infra/.env"
if [ ! -f "$ENVF" ]; then
  JETON=$(openssl rand -hex 32)
  umask 077
  {
    echo "GESTION_DPS_URL=http://gestion_dps_backend:3000/integrations/autorisation-conduite"
    echo "GESTION_DPS_TOKEN=$JETON"
    echo "GESTION_DPS_URL_INTERFACE=https://dps.corentinsg.ovh"
    echo "GESTIONNAIRES=$GESTIONNAIRES"
    echo "RTPA_FONCTION=RTPA"
    echo "RTPA_STRUCTURE=DT DE L'ARIEGE"
    echo "RTPA_EMAIL=rtpa.dt09@croix-rouge.fr"
    grep -E '^SMTP_(HOST|PORT|SECURE|USER|PASS)=' /opt/stock-secours/infra/.env
    echo 'SMTP_FROM="Autorisation de conduite <no-reply@croix-rouge-ariege.fr>"'
    echo "RETENTION_JOURS=400"
  } > "$ENVF"
  cp -p "$G" "$G.bak-$(date +%Y%m%d-%H%M%S)"
  sed -i '/^INTEGRATION_AUTORISATION_CONDUITE_TOKEN=/d; /^AUTORISATION_CONDUITE_RETOURS=/d' "$G"
  printf '\n# Générateur d'"'"'autorisation de conduite (CONTRAT_API_AUTORISATION_CONDUITE.md)\nINTEGRATION_AUTORISATION_CONDUITE_TOKEN=%s\nAUTORISATION_CONDUITE_RETOURS=https://autorisation-conduite.croix-rouge-ariege.fr/api/auth/retour\n' "$JETON" >> "$G"
  echo "  infra/.env créé, jeton ajouté à $G"
else
  sed -i "s#^GESTIONNAIRES=.*#GESTIONNAIRES=$GESTIONNAIRES#" "$ENVF"
  echo "  infra/.env existant conservé (GESTIONNAIRES mis à jour)"
fi
DISTANT

echo "→ Clé de déploiement limitée à deployer.sh"
ssh-keygen -q -t ed25519 -N "" -C "gh-actions autorisation-conduite" -f "$TMP/cle"
LIGNE="command=\"$BASE/deployer.sh\",restrict $(cat "$TMP/cle.pub")"
# Remplace la clé précédente de ce site (ancienne version rrsync comprise), sans toucher aux autres.
ssh "$HOTE" "cp ~/.ssh/authorized_keys ~/.ssh/authorized_keys.bak-\$(date +%Y%m%d-%H%M%S) \
  && sed -i '/gh-actions autorisation-conduite\$/d' ~/.ssh/authorized_keys \
  && printf '%s\n' '$LIGNE' >> ~/.ssh/authorized_keys"

echo "→ Secrets GitHub ($DEPOT_GH)"
gh secret set VPS_HOST -R "$DEPOT_GH" -b "$VPS_HOST"
gh secret set VPS_PORT -R "$DEPOT_GH" -b "$VPS_PORT"
gh secret set VPS_USER -R "$DEPOT_GH" -b "$VPS_USER"
gh secret set VPS_SSH_KEY -R "$DEPOT_GH" < "$TMP/cle"
ssh-keyscan -p "$VPS_PORT" "$VPS_HOST" 2>/dev/null | gh secret set VPS_KNOWN_HOSTS -R "$DEPOT_GH"

echo "→ Remplacement de l'ancien conteneur nginx et premier déploiement"
ssh "$HOTE" "docker rm -f autorisation_conduite_web >/dev/null 2>&1 || true; \
  rm -rf $BASE/www $BASE/docker-compose.yml $BASE/nginx.conf; \
  SSH_ORIGINAL_COMMAND=\$(git -C $BASE/depot rev-parse origin/main) $BASE/deployer.sh"
curl -fsS https://autorisation-conduite.croix-rouge-ariege.fr/healthz && echo "Site en ligne."
