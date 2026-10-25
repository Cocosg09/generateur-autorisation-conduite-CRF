#!/usr/bin/env bash
# Installation (ou réinstallation) du site sur le VPS, à lancer depuis un poste
# qui a déjà l'accès SSH au VPS et la CLI GitHub (gh) connectée.
#
#   infra/installer-vps.sh [hôte-ssh]        (par défaut : gestion-dps-vps)
#
# 1. Crée /opt/autorisation-conduite/{www} et y copie docker-compose.yml et nginx.conf.
# 2. Génère une clé SSH dédiée au déploiement, autorisée sur le VPS uniquement pour
#    écrire dans /opt/autorisation-conduite/www (rrsync -wo : ni shell, ni lecture).
# 3. Range cette clé et l'adresse du VPS dans les secrets GitHub du dépôt.
# 4. Démarre le conteneur web puis lance un premier déploiement.
# La clé privée n'est conservée que dans les secrets GitHub (copie locale effacée).
set -euo pipefail

HOTE=${1:-gestion-dps-vps}
DEPOT=Cocosg09/generateur-autorisation-conduite-CRF
DOSSIER=/opt/autorisation-conduite
cd "$(dirname "$0")"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

ssh_param() { ssh -G "$HOTE" | awk -v cle="$1" '$1 == cle { print $2; exit }'; }
VPS_HOST=$(ssh_param hostname)
VPS_USER=$(ssh_param user)
VPS_PORT=$(ssh_param port)

echo "→ Dossiers sur $VPS_USER@$VPS_HOST:$VPS_PORT"
ssh -t "$HOTE" "sudo install -d -o \"\$USER\" -g root -m 755 $DOSSIER $DOSSIER/www"
scp -q docker-compose.yml nginx.conf "$HOTE:$DOSSIER/"

echo "→ Clé de déploiement restreinte"
ssh-keygen -q -t ed25519 -N "" -C "gh-actions autorisation-conduite" -f "$TMP/cle"
LIGNE="command=\"/usr/bin/rrsync -wo $DOSSIER/www\",restrict $(cat "$TMP/cle.pub")"
# Remplace une éventuelle clé précédente de ce site, sans toucher aux autres.
ssh "$HOTE" "cp ~/.ssh/authorized_keys ~/.ssh/authorized_keys.bak-\$(date +%Y%m%d-%H%M%S) \
  && sed -i '\#rrsync -wo $DOSSIER/www\"#d' ~/.ssh/authorized_keys \
  && printf '%s\n' '$LIGNE' >> ~/.ssh/authorized_keys"

echo "→ Secrets GitHub ($DEPOT)"
gh secret set VPS_HOST -R "$DEPOT" -b "$VPS_HOST"
gh secret set VPS_PORT -R "$DEPOT" -b "$VPS_PORT"
gh secret set VPS_USER -R "$DEPOT" -b "$VPS_USER"
gh secret set VPS_SSH_KEY -R "$DEPOT" < "$TMP/cle"
ssh-keyscan -p "$VPS_PORT" "$VPS_HOST" 2>/dev/null | gh secret set VPS_KNOWN_HOSTS -R "$DEPOT"

echo "→ Conteneur web"
ssh "$HOTE" "cd $DOSSIER && docker compose up -d --wait"

echo "→ Premier déploiement"
gh workflow run deploy.yml -R "$DEPOT" --ref main
echo "Suivi : gh run watch -R $DEPOT"
