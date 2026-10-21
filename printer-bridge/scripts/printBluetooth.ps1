param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^COM[1-9][0-9]{0,3}$')]
    [string]$PortName,

    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [ValidateSet(9600, 19200, 38400, 57600, 115200)]
    [int]$BaudRate = 9600
)

$ErrorActionPreference = "Stop"
$serial = $null
$submissionStarted = $false
$exitCode = 0

try {
    $file = Get-Item -LiteralPath $FilePath -ErrorAction Stop
    if ($file.PSIsContainer -or $file.Length -lt 1 -or $file.Length -gt 65536) {
        throw "Print payload must contain between 1 and 65536 bytes."
    }

    [byte[]]$bytes = [System.IO.File]::ReadAllBytes($file.FullName)
    if ($bytes.Length -lt 1 -or $bytes.Length -gt 65536) {
        throw "Invalid print payload size."
    }

    if ([System.IO.Ports.SerialPort]::GetPortNames() -notcontains $PortName) {
        throw "Selected serial port is unavailable."
    }

    $serial = [System.IO.Ports.SerialPort]::new(
        $PortName,
        $BaudRate,
        [System.IO.Ports.Parity]::None,
        8,
        [System.IO.Ports.StopBits]::One
    )
    $serial.Handshake = [System.IO.Ports.Handshake]::None
    $serial.WriteTimeout = 5000
    $serial.Open()

    $submissionStarted = $true
    $serial.Write($bytes, 0, $bytes.Length)

    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while ($serial.BytesToWrite -gt 0) {
        if ([DateTime]::UtcNow -ge $deadline) {
            throw "Timed out waiting for serial output."
        }
        Start-Sleep -Milliseconds 50
    }

    # Allow a short settling period before releasing the Bluetooth port.
    Start-Sleep -Milliseconds 300

    Write-Output ('JYAANO_PRINT_JOB=' + (
        @{
            submitted = $true
            physicalPrintConfirmed = $false
        } | ConvertTo-Json -Compress
    ))
}
catch {
    $exitCode = 1
    $code = "print-job-failed"
    if ($submissionStarted) {
        $code = "print-result-unknown"
    }

    [Console]::Error.WriteLine('JYAANO_PRINTER_ERROR=' + (
        @{
            code = $code
            message = $_.Exception.Message
            submissionStarted = $submissionStarted
        } | ConvertTo-Json -Compress
    ))
}
finally {
    if ($null -ne $serial) {
        try {
            if ($serial.IsOpen) { $serial.Close() }
        }
        catch {
            # Cleanup must not trigger another print attempt.
        }
        $serial.Dispose()
    }
}

exit $exitCode
