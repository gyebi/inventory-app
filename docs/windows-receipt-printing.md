# Windows receipt printing

The local printer bridge sends ESC/POS bytes to a **Windows print queue**. The queue can represent a USB, Bluetooth, serial, or network-connected thermal printer; despite the legacy configuration name `windows-usb`, the selected queue name is what matters. The bridge does not replace the Linux MPT-II RFCOMM adapter.

## Print path

1. In **Printer Settings**, choose **Local Print Service**, then choose **Windows Printer (USB/Bluetooth)** and select the exact printer queue returned by Windows.
2. The browser calls the loopback bridge at `http://127.0.0.1:17820` for `/status`, `/printers`, `/test-print`, and `/print`.
3. The Node bridge discovers queues with `Get-Printer`, validates the configured queue, creates ESC/POS receipt bytes, then invokes `scripts/printRaw.ps1`.
4. The PowerShell helper uses the Windows spooler RAW API (`OpenPrinter`, `StartDocPrinter`, and `WritePrinter`). A successful response means Windows accepted the job, not that paper definitely emerged.
5. Windows drivers, the spooler, the selected port, and the physical printer complete the delivery. Confirm a physical receipt before treating a test as successful.

The regular browser **Print** button uses the browser/Windows print dialog and does not use this bridge. It must be diagnosed through the selected browser printer and Windows spooler instead.

## Install and start the bridge

Run these commands in PowerShell on the same Windows account that uses the Inventory browser. This is important because printer connections and permissions can be user-specific.

```powershell
node --version
Set-Location C:\path\to\inventory-app
$env:INVENTORY_ALLOWED_ORIGINS = "https://inventory-app-19d04.web.app"
node .\printer-bridge\server.js
```

For local Vite development, add the local origin as a comma-separated value, for example:

```powershell
$env:INVENTORY_ALLOWED_ORIGINS = "https://inventory-app-19d04.web.app,http://127.0.0.1:5173"
```

Keep the terminal open while testing. A production installation should run this command through an account-scoped startup mechanism only after a manual test succeeds. Do not run it as a different service account unless that account has the same printer visibility and print permission.

## Preflight diagnostics

Run these commands before configuring the app:

```powershell
Get-Service Spooler | Select-Object Status, Name, StartType
Get-Printer | Select-Object Name, PrinterStatus, WorkOffline, PortName, DriverName, Type
Get-PrinterDriver | Select-Object Name, MajorVersion
Test-NetConnection 127.0.0.1 -Port 17820
Invoke-RestMethod http://127.0.0.1:17820/status | ConvertTo-Json -Depth 6
Invoke-RestMethod http://127.0.0.1:17820/printers | ConvertTo-Json -Depth 6
```

If `Spooler` is not `Running`, use an elevated PowerShell prompt to start it:

```powershell
Start-Service Spooler
```

Use the `Name` value returned by `/printers` exactly; it is case-insensitive in the bridge but must refer to a queue installed for the bridge user. Select that queue in the application rather than typing a Bluetooth device name or a USB hardware label.

## Test on physical hardware

1. Load paper and confirm the printer can print its own self-test.
2. In Windows Settings, print a test page to the target queue. For many ESC/POS thermal printers this only proves driver/spooler connectivity, not receipt formatting.
3. Start the bridge, then confirm `/status` returns `ready: true` and `/printers` lists the target queue.
4. In the app, select and save the queue in **Printer Settings**.
5. Select **Test Print**. The UI confirms only that the local bridge accepted a job.
6. Confirm a paper receipt physically printed. Then complete one non-production sale/reprint workflow and confirm the receipt contents, paper width, cut/feed behavior, and lack of duplicate jobs.
7. Inspect the Windows queue while testing:

```powershell
Get-PrintJob -PrinterName "XP-80C"
Get-WinEvent -LogName Microsoft-Windows-PrintService/Operational -MaxEvents 30 |
  Select-Object TimeCreated, Id, LevelDisplayName, Message
```

Replace `XP-80C` with the exact selected queue. If the operational event log is unavailable, enable **Microsoft-Windows-PrintService/Operational** in Event Viewer before reproducing the issue.

## Error categories and repair actions

| Error code | Meaning | Repair |
| --- | --- | --- |
| `bridge-offline` | Browser could not contact the loopback bridge. This can also be a browser CORS/Private Network Access policy failure. | Start the bridge on this computer, verify port 17820, verify `INVENTORY_ALLOWED_ORIGINS`, and check browser local-network permissions/policies. |
| `printer-not-found` | The configured queue is absent for the bridge user. | Install/reconnect the printer, then refresh queues and select the exact listed name. |
| `printer-offline` | Windows reports the queue offline, paused, unavailable, or in an error state. | Check cable/power/Bluetooth pairing and port, clear paused/offline state, and restart the spooler if needed. |
| `driver-error` | Windows rejected the RAW job because of a driver-side failure. | Reinstall the manufacturer ESC/POS/thermal driver, verify the queue port, then test from Windows before retrying the bridge. |
| `permission-denied` | The bridge account cannot enumerate or submit to the queue. | Run the bridge as the interactive account that owns the printer connection; review queue security permissions. |
| `print-job-failed` | The spooler RAW API failed at a reported stage. | Record the `stage` and `win32Error` details, inspect the queue/event log, and share both with support. |

Bluetooth on Windows is supported only through an installed Windows printer queue. Pairing a device without a print queue, or using a Bluetooth device label instead of the queue name, will result in `printer-not-found`. The Linux RFCOMM/MPT-II setup is separate and documented in `printer-bridge/deployment/README.md`.

## Information needed for an unresolved Windows failure

Do not guess at a driver or hardware repair. Capture the exact app error code/message, `/status` and `/printers` responses, the selected queue name, `Get-Printer` output, the bridge terminal output, and the relevant PrintService event. Also identify whether the printer is USB, Bluetooth, serial, or network connected and whether a Windows test page physically prints.
