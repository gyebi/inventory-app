# MPT-II 58 mm Bluetooth printer: Linux deployment

This deployment uses a system service to bind the printer as `/dev/rfcomm0` and a per-user systemd service for the Node printer bridge. The bridge listens only on `127.0.0.1:17820`; it is intentionally not reachable from the LAN.

## Safe review first

Run this from the repository checkout as the desktop user that will run the bridge. The command validates prerequisites and the existing RFCOMM binding, but does not write files, change permissions, enable/restart services, or bind Bluetooth.

```bash
cd printer-bridge/deployment
./install-linux.sh --mac AA:BB:CC:DD:EE:FF --channel 1 \
  --origin https://inventory-app-19d04.web.app --dry-run
```

Replace the example address with the printer's real Bluetooth MAC address. It is never stored in the repository. `--channel` defaults to `1`, and `--origin` defaults to the Firebase production origin. The origin may also be `http://localhost[:port]` or `http://127.0.0.1[:port]` for local development. Public origins must be HTTPS and may not contain a path.

The desktop user must belong to `dialout`. If preflight says it does not, an administrator must run `sudo usermod -aG dialout "$USER"`; sign out and back in before continuing. Do not run the installer itself as root.

## Install during an approved maintenance window

After reviewing a passing dry-run, use the same command without `--dry-run`:

```bash
./install-linux.sh --mac AA:BB:CC:DD:EE:FF --channel 1 \
  --origin https://inventory-app-19d04.web.app
```

It creates `/etc/inventory-printer/printer.conf` (root-readable only), installs the RFCOMM helper and `inventory-rfcomm.service`, and writes the user service to `~/.config/systemd/user/inventory-printer.service`. It resolves the active Node executable with `node -p process.execPath`, so an NVM Node installation is recorded as an absolute executable path in the service.

The installer saves a snapshot under `/etc/inventory-printer/backups/` before every installation and enables both units, but deliberately does **not** start or restart either one. A repeat with the same arguments is safe and produces a fresh rollback point. If an existing `rfcomm0` belongs to another MAC/channel, the installer refuses to proceed.

To restore the latest snapshot (also without starting services):

```bash
./install-linux.sh --rollback --dry-run
./install-linux.sh --rollback
```

Rollback restores files and the enabled/disabled state captured in that snapshot. It does not delete backup history.

## Reboot and physical verification

Use these only after the change has been approved and installed:

```bash
sudo reboot
# after signing in again
systemctl status inventory-rfcomm.service --no-pager
systemctl --user status inventory-printer.service --no-pager
rfcomm show 0
curl -sS http://127.0.0.1:17820/status
```

The RFCOMM status must show the intended MAC address and `channel 1`; the bridge status must identify the Linux RFCOMM printer. Then perform a physical receipt test from the Inventory UI, or (from the same local computer):

```bash
curl -sS -X POST http://127.0.0.1:17820/test-print
```

Only use the test-print command while the printer is loaded with paper and a test receipt is expected.

## Troubleshooting

- `rfcomm0 is already bound`: preserve the working binding. Inspect it with `rfcomm show 0`; do not unbind it until the ownership is understood.
- `not in dialout`: add the bridge user to the group, then log out/in. A running user service does not gain new group membership until a new login session.
- Node service exits after reboot: inspect `journalctl --user -u inventory-printer.service -b --no-pager`. Re-run dry-run after loading the intended NVM Node version, then reinstall during a maintenance window.
- RFCOMM service fails: inspect `sudo journalctl -u inventory-rfcomm.service -b --no-pager` and confirm `bluetooth.service` is active and the printer is paired/trusted by the host.
- Browser cannot reach the bridge: use the exact configured HTTPS origin. The bridge sends the Chromium Private Network Access CORS response header, but current Chrome/enterprise policies can still require a user or administrator local-network permission. This is a browser policy limitation, not a reason to expose the bridge on the LAN.

## Security and compatibility limits

The origin check is a browser control, not authentication against a malicious local process. Any account that can make requests to loopback can attempt to print; protect the logged-in desktop accordingly. Requests without `Origin` are accepted only from loopback for local diagnostics. `Origin: null` is rejected. The bridge remains loopback-only, and it accepts the configured origin plus localhost development origins.

The templates assume systemd, BlueZ's `rfcomm`, `/dev/rfcomm0`, and RFCOMM channel 1. Other Linux init systems, different device numbers, or printers that need a different serial channel are out of scope for this installer.

## Additional Linux machines

Copy or clone the same application revision, install its Node dependencies, pair and trust that machine's printer, then run the safe dry-run with that machine's MAC address. Do not copy `/etc/inventory-printer/printer.conf` or a backup directory from another computer: those are machine-specific.

## Automated tests

These commands are safe to run from the repository root. The installer test uses temporary directories and fake system/Bluetooth commands; it never writes to `/etc` or calls real systemd/RFCOMM targets.

```bash
bash printer-bridge/deployment/test-install-linux.sh
node --test printer-bridge/test/server-authorization.test.js
bash -n printer-bridge/deployment/install-linux.sh \
  printer-bridge/deployment/inventory-rfcomm-bind
```
