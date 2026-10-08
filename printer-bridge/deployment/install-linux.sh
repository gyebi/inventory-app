#!/usr/bin/env bash
# Inventory MPT-II Linux installer. It never starts or restarts either service.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_DIR="${INVENTORY_PROJECT_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd -P)}"
# Overrides are solely for automated tests; production uses these defaults.
CONFIG_DIR="${INVENTORY_CONFIG_DIR:-/etc/inventory-printer}"
SYSTEMD_DIR="${INVENTORY_SYSTEMD_DIR:-/etc/systemd/system}"
HELPER_PATH="${INVENTORY_HELPER_PATH:-/usr/local/sbin/inventory-rfcomm-bind}"
USER_SYSTEMD_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
RFCOMM_DEVICE=0
DEFAULT_ORIGIN="https://inventory-app-19d04.web.app"
PRINTER_MAC=""; RFCOMM_CHANNEL=1; ALLOWED_ORIGIN="$DEFAULT_ORIGIN"
DRY_RUN=false; ROLLBACK=false

usage() {
  cat <<'HELP'
Usage:
  ./install-linux.sh --mac ADDRESS [--channel N] [--origin URL] [--dry-run]
  ./install-linux.sh --rollback [--dry-run]

Options:
  --mac       MPT-II Bluetooth address (required for installation)
  --channel   RFCOMM channel, 1-30 (default: 1)
  --origin    Authorized web origin (default: production Firebase origin)
  --dry-run   Validate and show planned changes without writing or enabling anything
  --rollback  Restore the most recent installer backup
  --help      Show this help

The installer configures /dev/rfcomm0, but does not bind it or start/restart a
service. Activate a new installation only during an approved test window.
HELP
}
die() { echo "ERROR: $*" >&2; exit 1; }
is_valid_mac() { [[ "$1" =~ ^([[:xdigit:]]{2}:){5}[[:xdigit:]]{2}$ ]]; }
is_valid_channel() { [[ "$1" =~ ^[1-9][0-9]*$ ]] && ((${#1} <= 2)) && ((10#$1 <= 30)); }
is_valid_origin() {
  [[ "$1" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] ||
    [[ "$1" =~ ^http://(localhost|127\.0\.0\.1)(:[0-9]+)?$ ]]
}
require_file() { [[ -f "$1" ]] || die "Required project file is missing: $1"; }
require_tool() { command -v "$1" >/dev/null 2>&1 || die "Required tool is missing: $1"; }

while (($#)); do
  case "$1" in
    --mac|--channel|--origin)
      (($# >= 2)) || die "Missing value for $1"
      case "$1" in --mac) PRINTER_MAC="$2";; --channel) RFCOMM_CHANNEL="$2";; --origin) ALLOWED_ORIGIN="$2";; esac
      shift 2;;
    --dry-run) DRY_RUN=true; shift;;
    --rollback) ROLLBACK=true; shift;;
    --help) usage; exit 0;;
    *) die "Unknown argument: $1";;
  esac
done

validate_platform() {
  [[ "$(uname -s)" == Linux ]] || die "This installer supports Linux only."
  [[ "$EUID" -ne 0 ]] || die "Run as the desktop user, not root; sudo is used only for system files."
}
validate_project() {
  [[ -d "$PROJECT_DIR" && "$PROJECT_DIR" != *$'\n'* && "$PROJECT_DIR" != *$'\r'* ]] || die "Invalid project directory."
  require_file "$PROJECT_DIR/printer-bridge/server.js"
  require_file "$SCRIPT_DIR/inventory-rfcomm-bind"
  require_file "$SCRIPT_DIR/inventory-rfcomm.service"
  require_file "$SCRIPT_DIR/inventory-printer.service"
}
NODE_PATH=""
resolve_node() {
  require_tool node
  # node reports its actual executable, including when node comes from NVM.
  NODE_PATH="$(node -p 'process.execPath' 2>/dev/null)" || die "Unable to resolve active Node.js."
  [[ "$NODE_PATH" = /* && -x "$NODE_PATH" ]] || die "Node.js did not resolve to an executable absolute path."
}
validate_prerequisites() {
  local tool
  for tool in rfcomm bluetoothctl systemctl sudo install awk date find sort tail mktemp; do require_tool "$tool"; done
  resolve_node
  id -nG | tr ' ' '\n' | grep -qx dialout || die "User $(id -un) is not in dialout; add it, then sign out and back in."
}

# Configuration is data, never shell code. Accept only the values emitted below.
read_machine_config() {
  local config="$1" line key value contents
  CONFIG_MAC=""; CONFIG_CHANNEL=""; CONFIG_DEVICE=""
  [[ -e "$config" ]] || return 0
  # Config is root-readable because the system service consumes it. Read it
  # through sudo as data; command substitution does not evaluate its contents.
  contents="$(sudo cat -- "$config")" || die "Unable to read existing configuration: $config"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^(PRINTER_MAC|RFCOMM_CHANNEL|RFCOMM_DEVICE)=([^[:space:]#]+)$ ]]; then
      key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
      case "$key" in
        PRINTER_MAC) [[ -z "$CONFIG_MAC" ]] || die "Duplicate PRINTER_MAC in $config"; CONFIG_MAC="$value";;
        RFCOMM_CHANNEL) [[ -z "$CONFIG_CHANNEL" ]] || die "Duplicate RFCOMM_CHANNEL in $config"; CONFIG_CHANNEL="$value";;
        RFCOMM_DEVICE) [[ -z "$CONFIG_DEVICE" ]] || die "Duplicate RFCOMM_DEVICE in $config"; CONFIG_DEVICE="$value";;
      esac
    else die "Unsafe or unsupported line in $config"; fi
  done <<< "$contents"
  if [[ -n "$CONFIG_MAC$CONFIG_CHANNEL$CONFIG_DEVICE" ]]; then
    is_valid_mac "$CONFIG_MAC" || die "Invalid PRINTER_MAC in $config"
    is_valid_channel "$CONFIG_CHANNEL" || die "Invalid RFCOMM_CHANNEL in $config"
    [[ "$CONFIG_DEVICE" == 0 ]] || die "Existing configuration must use RFCOMM device 0."
  fi
}
binding_status() { RFCOMM_STATUS="$(rfcomm show "$RFCOMM_DEVICE" 2>/dev/null || true)"; }
validate_binding() {
  binding_status; [[ -z "$RFCOMM_STATUS" ]] && return
  local lower="${RFCOMM_STATUS,,}" mac_lower="${PRINTER_MAC,,}"
  [[ "$lower" == *"$mac_lower"* && "$RFCOMM_STATUS" =~ channel[[:space:]]+$RFCOMM_CHANNEL([[:space:]]|$) ]] && return
  die "rfcomm0 is already bound to a different printer or channel. Refusing to replace it."
}
render_user_service() {
  local output="$1"
  awk -v project="$PROJECT_DIR" -v node="$NODE_PATH" -v origin="$ALLOWED_ORIGIN" '
    function repl(s) { gsub(/&/, "\\\\&", s); return s }
    { line=$0; gsub(/__PROJECT_DIR__/, repl(project), line); gsub(/__NODE_PATH__/, repl(node), line); gsub(/__ALLOWED_ORIGINS__/, repl(origin), line); print line }
  ' "$SCRIPT_DIR/inventory-printer.service" > "$output"
}

backup_root=""
make_backup() {
  local stamp target name state
  # Nanoseconds plus PID make lexical order match creation order on GNU/Linux.
  stamp="$(date -u +%Y%m%dT%H%M%S%N)-$(printf '%08d' "$$")"; backup_root="$CONFIG_DIR/backups/$stamp"
  sudo install -d -m 0700 "$backup_root/system" "$backup_root/user"
  : > "$TMP_DIR/manifest"
  for target in "$CONFIG_DIR/printer.conf" "$HELPER_PATH" "$SYSTEMD_DIR/inventory-rfcomm.service"; do
    name="$(basename "$target")"
    if sudo test -e "$target"; then
      printf '%s|present\n' "$target" >> "$TMP_DIR/manifest"; sudo install -m 0600 "$target" "$backup_root/system/$name"
    else printf '%s|absent\n' "$target" >> "$TMP_DIR/manifest"; fi
  done
  target="$USER_SYSTEMD_DIR/inventory-printer.service"
  if [[ -e "$target" ]]; then
    printf '%s|present\n' "$target" >> "$TMP_DIR/manifest"; sudo install -m 0600 "$target" "$backup_root/user/inventory-printer.service"
  else printf '%s|absent\n' "$target" >> "$TMP_DIR/manifest"; fi
  if systemctl is-enabled --quiet inventory-rfcomm.service 2>/dev/null; then state=enabled; else state=disabled; fi
  printf 'system-service|%s\n' "$state" >> "$TMP_DIR/manifest"
  if systemctl --user is-enabled --quiet inventory-printer.service 2>/dev/null; then state=enabled; else state=disabled; fi
  printf 'user-service|%s\n' "$state" >> "$TMP_DIR/manifest"
  sudo install -m 0600 "$TMP_DIR/manifest" "$backup_root/manifest"
}
restore_target() {
  local target="$1" state="$2" backup="$3" user_file="${4:-}"
  if [[ "$state" == present ]]; then
    if [[ -n "$user_file" ]]; then sudo install -o "$USER" -g "$(id -g)" -m 0644 "$backup" "$target"
    else sudo install -m 0644 "$backup" "$target"; fi
  else sudo rm -f -- "$target"; fi
}
rollback() {
  local latest target state
  [[ -d "$CONFIG_DIR/backups" ]] || die "No installer backups exist."
  latest="$(sudo find "$CONFIG_DIR/backups" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort | tail -n 1)"
  [[ -n "$latest" ]] || die "No installer backups exist."
  backup_root="$CONFIG_DIR/backups/$latest"; sudo test -f "$backup_root/manifest" || die "Latest backup has no manifest."
  echo "Rollback source: $backup_root"
  if [[ "$DRY_RUN" == true ]]; then echo "DRY RUN: would restore manifest files; no changes made."; return; fi
  while IFS='|' read -r target state; do
    case "$target" in
      "$CONFIG_DIR/printer.conf") restore_target "$target" "$state" "$backup_root/system/printer.conf";;
      "$HELPER_PATH") restore_target "$target" "$state" "$backup_root/system/$(basename "$HELPER_PATH")";;
      "$SYSTEMD_DIR/inventory-rfcomm.service") restore_target "$target" "$state" "$backup_root/system/inventory-rfcomm.service";;
      "$USER_SYSTEMD_DIR/inventory-printer.service") restore_target "$target" "$state" "$backup_root/user/inventory-printer.service" user;;
      system-service) SYSTEM_SERVICE_STATE="$state";; user-service) USER_SERVICE_STATE="$state";;
      *) die "Invalid backup manifest entry.";;
    esac
  done < <(sudo cat "$backup_root/manifest")
  sudo systemctl daemon-reload; systemctl --user daemon-reload
  if [[ "${SYSTEM_SERVICE_STATE:-disabled}" == enabled ]]; then sudo systemctl enable inventory-rfcomm.service; else sudo systemctl disable inventory-rfcomm.service; fi
  if [[ "${USER_SERVICE_STATE:-disabled}" == enabled ]]; then systemctl --user enable inventory-printer.service; else systemctl --user disable inventory-printer.service; fi
  echo "Rollback complete. Services were not started or restarted."
}
install_files() {
  TMP_DIR="$(mktemp -d)"; trap 'rm -rf -- "$TMP_DIR"' EXIT
  local service="$TMP_DIR/inventory-printer.service" config="$TMP_DIR/printer.conf"
  render_user_service "$service"; umask 077
  printf 'PRINTER_MAC=%s\nRFCOMM_CHANNEL=%s\nRFCOMM_DEVICE=%s\n' "$PRINTER_MAC" "$RFCOMM_CHANNEL" "$RFCOMM_DEVICE" > "$config"
  make_backup
  sudo install -d -m 0755 "$CONFIG_DIR" "$SYSTEMD_DIR" "$(dirname "$HELPER_PATH")"
  sudo install -m 0600 "$config" "$CONFIG_DIR/printer.conf"
  sudo install -m 0755 "$SCRIPT_DIR/inventory-rfcomm-bind" "$HELPER_PATH"
  sudo install -m 0644 "$SCRIPT_DIR/inventory-rfcomm.service" "$SYSTEMD_DIR/inventory-rfcomm.service"
  install -d -m 0700 "$USER_SYSTEMD_DIR"; install -m 0644 "$service" "$USER_SYSTEMD_DIR/inventory-printer.service"
  sudo systemctl daemon-reload; systemctl --user daemon-reload
  sudo systemctl enable inventory-rfcomm.service; systemctl --user enable inventory-printer.service
  echo "Installed successfully. Backup: $backup_root"
  echo "No services were started or restarted. Reboot or start them during an approved test window."
}
main() {
  validate_platform; validate_project; validate_prerequisites
  if [[ "$ROLLBACK" == true ]]; then
    [[ -z "$PRINTER_MAC" && "$RFCOMM_CHANNEL" == 1 && "$ALLOWED_ORIGIN" == "$DEFAULT_ORIGIN" ]] || die "--rollback cannot be combined with printer options."
    rollback; exit 0
  fi
  is_valid_mac "$PRINTER_MAC" || die "Invalid or missing Bluetooth MAC address."
  is_valid_channel "$RFCOMM_CHANNEL" || die "Invalid RFCOMM channel (1-30)."
  is_valid_origin "$ALLOWED_ORIGIN" || die "Origin must be HTTPS, or http://localhost / http://127.0.0.1."
  read_machine_config "$CONFIG_DIR/printer.conf"; validate_binding
  echo "=== Inventory Printer Preflight ==="; echo "Project: $PROJECT_DIR"; echo "Node: $NODE_PATH"; echo "MAC: $PRINTER_MAC"; echo "Channel: $RFCOMM_CHANNEL"; echo "Origin: $ALLOWED_ORIGIN"
  [[ -n "$RFCOMM_STATUS" ]] && echo "rfcomm0: matching binding already present" || echo "rfcomm0: not currently bound"
  if [[ "$DRY_RUN" == true ]]; then
    echo "DRY RUN: would back up and install the RFCOMM system unit and printer-bridge user unit."
    echo "DRY RUN: no files, permissions, services, or Bluetooth bindings were changed."; exit 0
  fi
  install_files
}
main "$@"
