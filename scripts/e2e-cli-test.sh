#!/usr/bin/env bash
# ============================================================
# WALWATCH E2E TEST — CLI + HTTP version
#
# Uses:
#   - curl for API tests
#   - sui client for on-chain operations (bypasses deprecated JSON-RPC)
#
# Usage:
#   export SUI_PRIVATE_KEY="base64..."  # optional if sui client is configured
#   bash scripts/e2e-cli-test.sh
# ============================================================
set -eo pipefail

API_URL="${API_URL:-http://localhost:3001}"
PACKAGE_ID="${PACKAGE_ID:-0xb90affbce7a098615b842aadfcf1af47080755ddee2f2662c1f6ec156201bca7}"
FEE_CONFIG_ID="${FEE_CONFIG_ID:-0xc8f14c361bfffdfde60054daf5101da382e39d0bf655131fb4b6de69b12f6d40}"
SYSTEM_OBJECT_ID="${SYSTEM_OBJECT_ID:-0x6c2547cbbc38025cf3adac45f63cb0a8d12ecf777cdc75a4971612bf97fdf6af}"
WAL_COIN_TYPE="${WAL_COIN_TYPE:-0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL}"

PASS=0
FAIL=0
GAS_BUDGET="10000000"

assert() {
  local label="$1" condition="$2" detail="$3"
  if [ "$condition" = "true" ]; then
    echo "  ✅ $label"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $label${detail:+ — $detail}"
    FAIL=$((FAIL + 1))
  fi
}

api_get() {
  local path="$1" token="$2"
  local headers=(-H 'Content-Type: application/json')
  [ -n "$token" ] && headers+=(-H "Authorization: Bearer $token")
  curl -sf "$API_URL$path" "${headers[@]}" 2>/dev/null || echo '{"error":"fetch_failed"}'
}

api_post() {
  local path="$1" data="$2" token="$3"
  local headers=(-H 'Content-Type: application/json')
  [ -n "$token" ] && headers+=(-H "Authorization: Bearer $token")
  curl -sf -X POST "$API_URL$path" "${headers[@]}" -d "$data" 2>/dev/null || echo '{"error":"fetch_failed"}'
}

echo ""
echo "═══════════════════════════════════════════════════"
echo "  WALWATCH E2E TEST (CLI + HTTP)"
echo "═══════════════════════════════════════════════════"
echo ""

# ── PHASE 0: Setup ───────────────────────────
echo "── Phase 0: Prerequisites ──"
echo ""

# Check API health (returns 503 for degraded, but that's OK for testing)
HEALTH=$(api_get "/health")
assert "Health endpoint reachable" "$(echo "$HEALTH" | grep -c 'status' || true)" "got: ${HEALTH:0:80}"

# Check sui client works
SUI_ADDR=$(sui client active-address 2>/dev/null || echo "")
assert "Sui CLI available" "$([ -n "$SUI_ADDR" ] && echo true || echo false)" "address: ${SUI_ADDR:0:10}..."

# Check SUI balance
SUI_BAL=$(sui client gas 2>/dev/null | grep -oP 'mistBalance \(MIST\) │ \K\d+' || echo "0")
echo "  SUI balance: $(echo "scale=2; $SUI_BAL / 1000000000" | bc 2>/dev/null || echo "$SUI_BAL") SUI"

# ── PHASE 1: API Authentication ──────────────
echo ""
echo "── Phase 1: API Authentication ──"
echo ""

TIMESTAMP=$(date +%s)
TEST_EMAIL="e2e-test-${TIMESTAMP}@walwatch.test"
TEST_PASS="TestPass123!"

# Register
REG=$(api_post "/api/v1/auth/register" "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\",\"name\":\"E2E Test User\"}")
AUTH_TOKEN=$(echo "$REG" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null || echo "")
assert "1a. Register new user" "$([ -n "$AUTH_TOKEN" ] && echo true || echo false)"

# /me endpoint
ME=$(api_get "/api/v1/auth/me" "$AUTH_TOKEN")
ME_EMAIL=$(echo "$ME" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('user',{}).get('email',''))" 2>/dev/null || echo "")
assert "1b. GET /me returns email" "$([ "$ME_EMAIL" = "$TEST_EMAIL" ] && echo true || echo false)"

# Login
LOGIN=$(api_post "/api/v1/auth/login" "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}")
LOGIN_TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null || echo "")
assert "1c. Login returns token" "$([ -n "$LOGIN_TOKEN" ] && echo true || echo false)"

# Duplicate register (expect failure)
DUP_REG=$(api_post "/api/v1/auth/register" "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}")
DUP_STATUS=$(echo "$DUP_REG" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',{}).get('code','') if 'error' in json.load(sys.stdin) else 'ok')" 2>/dev/null || echo "")
assert "1d. Duplicate register rejected" "$([ -n "$DUP_STATUS" ] && echo true || echo false)"

# Wrong password
BAD_LOGIN=$(api_post "/api/v1/auth/login" "{\"email\":\"$TEST_EMAIL\",\"password\":\"WrongPass1!\"}")
BAD_ERR=$(echo "$BAD_LOGIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',{}).get('code',''))" 2>/dev/null || echo "")
assert "1e. Wrong password rejected" "$([ -n "$BAD_ERR" ] && echo true || echo false)"

# Key export (expect 404 without zkLogin keys)
KEY_EXPORT=$(api_get "/api/v1/keys/export" "$AUTH_TOKEN")
KEY_EXPORT_ERR=$(echo "$KEY_EXPORT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',{}).get('code',''))" 2>/dev/null || echo "")
assert "1f. Key export returns error code" "$([ -n "$KEY_EXPORT_ERR" ] && echo true || echo false)"

# ── PHASE 2: API Authorization ───────────────
echo ""
echo "── Phase 2: API Authorization ──"
echo ""

# Vault list without org header (expect 403 forbidden)
VAULTS_LIST_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $AUTH_TOKEN" "$API_URL/api/v1/vaults" 2>/dev/null || echo "000")
assert "2. Vault list without X-Org-Id returns 403" "$([ "$VAULTS_LIST_STATUS" = "403" ] && echo true || echo false)" "HTTP $VAULTS_LIST_STATUS"

# ── PHASE 3: On-Chain E2E with sui client ────
echo ""
echo "── Phase 3: On-Chain Vault Lifecycle ──"
echo ""

if [ -z "$SUI_ADDR" ]; then
  echo "  ⏭ Skipping on-chain tests (sui client not available)"
else
  # 3a. Check contract version via sui client call
  echo "  3a. Checking FeeConfig..."
  FEE_VERSION=$(sui client call --package "$PACKAGE_ID" --module vault --function get_version \
    --args "$FEE_CONFIG_ID" --gas-budget "$GAS_BUDGET" 2>/dev/null | grep -oP 'version: u64 = \K\d+' || echo "0")
  assert "3a. FeeConfig version = $FEE_VERSION" "$([ "$FEE_VERSION" -ge 1 ] && echo true || echo false)"

  # 3b. Check FeeConfig fields
  FEE_TREASURY=$(sui client call --package "$PACKAGE_ID" --module vault --function treasury_address \
    --args "$FEE_CONFIG_ID" --gas-budget "$GAS_BUDGET" 2>/dev/null | grep -oP '0x[0-9a-fA-F]+' | tail -1 || echo "")
  assert "3b. Treasury configured" "$([ -n "$FEE_TREASURY" ] && [ "$FEE_TREASURY" != "0x0000000000000000000000000000000000000000000000000000000000000000" ] && echo true || echo false)"

  FEE_BPS=$(sui client call --package "$PACKAGE_ID" --module vault --function protocol_fee_bps \
    --args "$FEE_CONFIG_ID" --gas-budget "$GAS_BUDGET" 2>/dev/null | grep -oP '\d+' | tail -1 || echo "0")
  assert "3c. Protocol fee bps = $FEE_BPS" "$([ "$FEE_BPS" -le 10000 ] && echo true || echo false)"

  # 3d. Check we have WAL coins
  echo "  3d. Checking WAL balance..."
  WAL_COINS=$(sui client objects 2>/dev/null | grep -c "$WAL_COIN_TYPE" || echo "0")
  if [ "$WAL_COINS" -ge 1 ]; then
    echo "  Found $WAL_COINS WAL coin(s)"
  else
    echo "  ⚠ No WAL coins found — on-chain vault test will fail"
  fi

  # 3e. Create a blob (via Walrus system call)
  echo "  3e. Creating blob..."
  BLOB_BYTES=$(echo -n "E2E test blob $(date -u +%Y-%m-%dT%H:%M:%SZ)" | base64 -w0)
  # Note: Blob creation requires Walrus storage payment, which is complex via CLI.
  # For now, we test the contract read operations and note this limitation.
  echo "  ⏭ Full vault lifecycle (create, deposit, withdraw) requires Walrus SDK"
  echo "     which uses JSON-RPC/GraphQL. Tested via sui client read operations."
fi

# ── SUMMARY ──────────────────────────────────
TOTAL=$((PASS + FAIL))
echo ""
echo "═══════════════════════════════════════════════════"
echo "  RESULTS: $PASS/$TOTAL passed, $FAIL/$TOTAL failed"
echo "═══════════════════════════════════════════════════"
echo ""

exit $FAIL
