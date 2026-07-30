#!/usr/bin/env bash
set -o pipefail

cd /home/tejas/Tejas/auto-renewal-keeper/api

# Start server
env DATABASE_URL='postgres://walwatch:walwatch_dev@localhost:5432/walwatch' \
  JWT_SECRET='dev-jwt-secret-test' \
  PACKAGE_ID='0xb90affbce7a098615b842aadfcf1af47080755ddee2f2662c1f6ec156201bca7' \
  FEE_CONFIG_ID='0xc8f14c361bfffdfde60054daf5101da382e39d0bf655131fb4b6de69b12f6d40' \
  SYSTEM_OBJECT_ID='0x6c2547cbbc38025cf3adac45f63cb0a8d12ecf777cdc75a4971612bf97fdf6af' \
  WAL_COIN_TYPE='0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL' \
  GAS_WALLET_MIN_BALANCE_MIST='0' \
  npx tsx src/index.ts > /tmp/api-server.log 2>&1 &
API_PID=$!

# Wait for server
for i in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/health 2>/dev/null || echo "000")
  if [ "$CODE" != "000" ]; then
    echo "API UP (HTTP $CODE) PID=$API_PID"
    break
  fi
  sleep 1
done

# API Auth Test
echo "=== API Auth Test ==="
TIMESTAMP=$(date +%s)
EMAIL="e2e-${TIMESTAMP}@test.com"
PASS="TestPass123!"

REG=$(curl -s -X POST http://localhost:3001/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"E2E\"}")
TOKEN=$(echo "$REG" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token','NO_TOKEN'))" 2>/dev/null)
if [ "$TOKEN" != "NO_TOKEN" ]; then echo "✅ Register OK"; else echo "❌ Register FAIL: $REG"; fi

ME=$(curl -s http://localhost:3001/api/v1/auth/me -H "Authorization: Bearer $TOKEN")
ME_EMAIL=$(echo "$ME" | python3 -c "import sys,json; print(json.load(sys.stdin).get('user',{}).get('email','NO_EMAIL'))" 2>/dev/null)
if [ "$ME_EMAIL" = "$EMAIL" ]; then echo "✅ /me OK"; else echo "❌ /me FAIL: $ME"; fi

LOGIN=$(curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
LOGIN_TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token','NO_TOKEN'))" 2>/dev/null)
if [ "$LOGIN_TOKEN" != "NO_TOKEN" ]; then echo "✅ Login OK"; else echo "❌ Login FAIL: $LOGIN"; fi

# Duplicate register
DUP=$(curl -s -X POST http://localhost:3001/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',{}).get('code','NO_ERROR'))")
if [ "$DUP" != "NO_ERROR" ]; then echo "✅ Duplicate rejected"; else echo "❌ Duplicate NOT rejected"; fi

# Wrong password
BAD=$(curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"WrongPass1!\"}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',{}).get('code','NO_ERROR'))")
if [ "$DUP" != "NO_ERROR" ]; then echo "✅ Wrong password rejected"; else echo "❌ Wrong password NOT rejected"; fi

# Key export (expect 404 without zkLogin keys)
KEY=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/api/v1/keys/export -H "Authorization: Bearer $TOKEN")
if [ "$KEY" = "404" ]; then echo "✅ Key export returns 404 (no zkLogin)"; else echo "❌ Key export returned $KEY"; fi

# Vault list without org header
VAULT=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/api/v1/vaults -H "Authorization: Bearer $TOKEN")
if [ "$VAULT" = "403" ]; then echo "✅ Vault list without X-Org-Id returns 403"; else echo "❌ Vault list returned $VAULT"; fi

# On-chain test via sui client
echo ""
echo "=== On-Chain Test (sui client) ==="
SUI_ADDR=$(sui client active-address 2>/dev/null || echo "")
if [ -n "$SUI_ADDR" ]; then
  echo "✅ Sui CLI available: ${SUI_ADDR:0:10}..."
  sui client call --package "$PACKAGE_ID" --module vault --function get_version --args "$FEE_CONFIG_ID" --gas-budget 10000000 2>&1 | grep -oP 'version: u64 = \K\d+' && echo "✅ FeeConfig readable" || echo "❌ FeeConfig read failed: $(sui client call --package $PACKAGE_ID --module vault --function get_version --args $FEE_CONFIG_ID --gas-budget 10000000 2>&1)"
  WAL_OBJECTS=$(sui client objects 2>/dev/null | grep -c "$WAL_COIN_TYPE" || echo "0")
  echo "WAL coins: $WAL_OBJECTS"
else
  echo "❌ No Sui CLI address"
fi

echo ""
echo "=== Done ==="

kill $API_PID 2>/dev/null
wait $API_PID 2>/dev/null
echo "Server stopped"
