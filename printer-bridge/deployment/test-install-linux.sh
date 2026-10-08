#!/usr/bin/env bash
# Isolated tests for install-linux.sh. They redirect all machine paths to /tmp
# and replace service/Bluetooth commands; this file never invokes the real installer targets.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
INSTALLER="$ROOT/printer-bridge/deployment/install-linux.sh"
TEMP="$(mktemp -d)"
trap 'rm -rf -- "$TEMP"' EXIT
FAKE="$TEMP/bin"; mkdir -p "$FAKE"
REAL_PATH="$PATH"; ACTUAL_USER="$(id -un)"; ACTUAL_GID="$(id -g)"

make_fake_tools() {
  local tool
  for tool in bluetoothctl; do printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE/$tool"; chmod +x "$FAKE/$tool"; done
  cat > "$FAKE/rfcomm" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${FAKE_LOG:?}"
if [[ "$1" == show && -n "${RFCOMM_SHOW:-}" ]]; then printf '%s\n' "$RFCOMM_SHOW"; fi
EOF
cat > "$FAKE/systemctl" <<'EOF'
#!/usr/bin/env bash
printf 'systemctl %s\n' "$*" >> "${FAKE_LOG:?}"
case "$*" in *is-enabled*) exit 1;; *) exit 0;; esac
EOF
  cat > "$FAKE/sudo" <<'EOF'
#!/usr/bin/env bash
printf 'sudo %s\n' "$*" >> "${FAKE_LOG:?}"
exec "$@"
EOF
  cat > "$FAKE/id" <<EOF
#!/usr/bin/env bash
case "\${1:-}" in
  -nG) echo "$ACTUAL_USER dialout";;
  -un) echo "$ACTUAL_USER";;
  -g) echo "$ACTUAL_GID";;
  *) exec /usr/bin/id "\$@";;
esac
EOF
  chmod +x "$FAKE/rfcomm" "$FAKE/systemctl" "$FAKE/sudo" "$FAKE/id"
}
make_fake_tools

pass=0; fail=0
ok() { pass=$((pass + 1)); printf 'ok - %s\n' "$1"; }
not_ok() { fail=$((fail + 1)); printf 'not ok - %s\n' "$1" >&2; }
assert_contains() { [[ "$1" == *"$2"* ]]; }
run_installer() {
  local case_dir="$1"; shift
  mkdir -p "$case_dir"
  FAKE_LOG="$case_dir/calls.log" PATH="$FAKE:$REAL_PATH" \
    INVENTORY_CONFIG_DIR="$case_dir/etc/inventory-printer" \
    INVENTORY_SYSTEMD_DIR="$case_dir/etc/systemd/system" \
    INVENTORY_HELPER_PATH="$case_dir/usr/local/sbin/inventory-rfcomm-bind" \
    XDG_CONFIG_HOME="$case_dir/home/.config" \
    "$INSTALLER" "$@"
}

if output="$(run_installer "$TEMP/invalid" --mac bad --dry-run 2>&1)"; then not_ok "reject invalid MAC"; elif assert_contains "$output" "Invalid or missing Bluetooth"; then ok "reject invalid MAC"; else not_ok "reject invalid MAC"; fi

MISSING_BIN="$TEMP/missing-bin"; mkdir -p "$MISSING_BIN"
ln -s /usr/bin/dirname "$MISSING_BIN/dirname"; ln -s /usr/bin/uname "$MISSING_BIN/uname"; ln -s "$FAKE/rfcomm" "$MISSING_BIN/rfcomm"
if output="$(PATH="$MISSING_BIN" INVENTORY_CONFIG_DIR="$TEMP/missing/etc" /bin/bash "$INSTALLER" --mac AA:BB:CC:DD:EE:FF --dry-run 2>&1)"; then not_ok "report missing dependency"; elif assert_contains "$output" "Required tool is missing: bluetoothctl"; then ok "report missing dependency"; else not_ok "report missing dependency"; fi

if output="$(RFCOMM_SHOW='rfcomm0: 11:22:33:44:55:66 channel 2 connected' run_installer "$TEMP/conflict" --mac AA:BB:CC:DD:EE:FF --channel 1 --dry-run 2>&1)"; then not_ok "reject conflicting RFCOMM binding"; elif assert_contains "$output" "already bound"; then ok "reject conflicting RFCOMM binding"; else not_ok "reject conflicting RFCOMM binding"; fi

dry="$TEMP/dry"
if output="$(run_installer "$dry" --mac AA:BB:CC:DD:EE:FF --dry-run 2>&1)" && [[ ! -e "$dry/etc/inventory-printer/printer.conf" ]] && ! grep -qE 'sudo|bind|systemctl.*(enable|daemon-reload)' "$dry/calls.log"; then ok "dry-run makes no installation changes"; else not_ok "dry-run makes no installation changes"; fi

existing="$TEMP/existing"
mkdir -p "$existing/etc/inventory-printer" "$existing/etc/systemd/system" "$existing/usr/local/sbin" "$existing/home/.config/systemd/user"
printf 'PRINTER_MAC=11:22:33:44:55:66\nRFCOMM_CHANNEL=1\nRFCOMM_DEVICE=0\n' > "$existing/etc/inventory-printer/printer.conf"
printf 'old system unit\n' > "$existing/etc/systemd/system/inventory-rfcomm.service"
printf 'old user unit\n' > "$existing/home/.config/systemd/user/inventory-printer.service"
if output="$(run_installer "$existing" --mac AA:BB:CC:DD:EE:FF --origin https://inventory-app-19d04.web.app 2>&1)" &&
  grep -q 'PRINTER_MAC=AA:BB:CC:DD:EE:FF' "$existing/etc/inventory-printer/printer.conf" &&
  grep -q 'ExecStart=.*printer-bridge/server.js' "$existing/home/.config/systemd/user/inventory-printer.service" &&
  [[ "$(find "$existing/etc/inventory-printer/backups" -mindepth 1 -maxdepth 1 -type d | wc -l)" -eq 1 ]]; then ok "back up and replace pre-existing services"; else not_ok "back up and replace pre-existing services"; fi

if output="$(run_installer "$existing" --mac AA:BB:CC:DD:EE:FF 2>&1)" && [[ "$(find "$existing/etc/inventory-printer/backups" -mindepth 1 -maxdepth 1 -type d | wc -l)" -eq 2 ]]; then ok "repeated installation is idempotent"; else not_ok "repeated installation is idempotent"; fi

if output="$(run_installer "$existing" --rollback 2>&1)" &&
  grep -q 'PRINTER_MAC=AA:BB:CC:DD:EE:FF' "$existing/etc/inventory-printer/printer.conf"; then ok "rollback restores the prior installation snapshot"; else not_ok "rollback restores the prior installation snapshot"; fi

printf '%s tests passed; %s failed\n' "$pass" "$fail"
((fail == 0))
