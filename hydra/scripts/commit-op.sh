#!/bin/bash
# Commit operator's UTxO to the Hydra Head.
# Blueprint tx contains ONLY the committed UTxO; Hydra adds fuel internally.
set -e
CARDANO_CLI=/home/rodrigo/workspace/hydra_test/bin/cardano-cli
NODE_SOCKET=/home/rodrigo/workspace/hydra_test/cardano_preprod/sockets/node.socket
SKEY=/home/rodrigo/hydra-nft-marketplace/hydra/keys/cardano.skey
ADDR=addr_test1vzwe88xlns54mlth6r0tgpm86fapn6yqvdegyr6wepw0rgcgg73e8

# UTxO being committed (goes into the Head)
COMMIT_UTXO=e247f479af1281c1e7eacc1d089196a51bf65e31bec0bcf538853045db17d73d#2
COMMIT_LOVELACE=47332658

export CARDANO_NODE_SOCKET_PATH=$NODE_SOCKET

echo "Building blueprint tx (committed UTxO only)..."
$CARDANO_CLI latest transaction build-raw \
  --tx-in $COMMIT_UTXO \
  --tx-out ${ADDR}+${COMMIT_LOVELACE} \
  --fee 0 \
  --out-file /tmp/bp4.json

echo "Building request body..."
python3 << 'PYEOF'
import json
bp = json.load(open('/tmp/bp4.json'))
addr = 'addr_test1vzwe88xlns54mlth6r0tgpm86fapn6yqvdegyr6wepw0rgcgg73e8'
utxo_spec = {
  'address': addr,
  'datum': None, 'datumhash': None, 'inlineDatum': None,
  'referenceScript': None,
  'value': {'lovelace': 47332658}
}
body = {
  'blueprintTx': bp,
  'utxo': {'e247f479af1281c1e7eacc1d089196a51bf65e31bec0bcf538853045db17d73d#2': utxo_spec}
}
json.dump(body, open('/tmp/commit-body4.json', 'w'))
print('Body written OK')
PYEOF

echo "Calling Hydra /commit..."
HTTP_CODE=$(curl -s -o /tmp/commit-tx4.json -w "%{http_code}" \
  -X POST http://127.0.0.1:4001/commit \
  -H 'Content-Type: application/json' \
  -d @/tmp/commit-body4.json)

echo "HTTP $HTTP_CODE"
if [ "$HTTP_CODE" != "200" ]; then
  echo "Error response (first 200 chars):"
  head -c 200 /tmp/commit-tx4.json
  echo ""
  exit 1
fi

echo "Success. Signing..."
$CARDANO_CLI latest transaction sign \
  --tx-file /tmp/commit-tx4.json \
  --signing-key-file $SKEY \
  --testnet-magic 1 \
  --out-file /tmp/commit-signed4.json

echo "Submitting to L1..."
$CARDANO_CLI latest transaction submit \
  --tx-file /tmp/commit-signed4.json \
  --testnet-magic 1

TXID=$($CARDANO_CLI latest transaction txid --tx-file /tmp/commit-signed4.json)
echo "Committed! TX: $TXID"
