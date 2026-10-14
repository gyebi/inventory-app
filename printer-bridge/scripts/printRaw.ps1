param(
    [Parameter(Mandatory=$true)]
    [string]$PrinterName,

    [Parameter(Mandatory=$true)]
    [string]$FilePath
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFO
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    public class PrintResult
    {
        public bool Success;
        public int JobId;
        public string Stage;
        public int Win32Error;
        public int BytesWritten;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool OpenPrinter(string printerName, out IntPtr printerHandle, IntPtr printerDefaults);
    [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr printerHandle);
    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern int StartDocPrinter(IntPtr printerHandle, int level, [In] DOCINFO docInfo);
    [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr printerHandle);
    [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr printerHandle);
    [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr printerHandle);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr printerHandle, IntPtr bytes, int count, out int written);

    public static PrintResult SendBytes(string printerName, byte[] bytes)
    {
        IntPtr printerHandle = IntPtr.Zero;
        IntPtr unmanagedBytes = IntPtr.Zero;
        bool documentStarted = false;
        bool pageStarted = false;
        PrintResult result = new PrintResult { Stage = "OpenPrinter" };

        try
        {
            if (!OpenPrinter(printerName, out printerHandle, IntPtr.Zero))
            {
                result.Win32Error = Marshal.GetLastWin32Error();
                return result;
            }

            result.Stage = "StartDocPrinter";
            DOCINFO docInfo = new DOCINFO { pDocName = "Inventory Receipt", pDataType = "RAW" };
            result.JobId = StartDocPrinter(printerHandle, 1, docInfo);
            if (result.JobId == 0)
            {
                result.Win32Error = Marshal.GetLastWin32Error();
                return result;
            }
            documentStarted = true;

            result.Stage = "StartPagePrinter";
            if (!StartPagePrinter(printerHandle))
            {
                result.Win32Error = Marshal.GetLastWin32Error();
                return result;
            }
            pageStarted = true;

            result.Stage = "WritePrinter";
            unmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
            Marshal.Copy(bytes, 0, unmanagedBytes, bytes.Length);
            if (!WritePrinter(printerHandle, unmanagedBytes, bytes.Length, out result.BytesWritten) || result.BytesWritten != bytes.Length)
            {
                result.Win32Error = Marshal.GetLastWin32Error();
                return result;
            }

            result.Success = true;
            return result;
        }
        finally
        {
            if (unmanagedBytes != IntPtr.Zero) Marshal.FreeCoTaskMem(unmanagedBytes);
            if (pageStarted) EndPagePrinter(printerHandle);
            if (documentStarted) EndDocPrinter(printerHandle);
            if (printerHandle != IntPtr.Zero) ClosePrinter(printerHandle);
        }
    }
}
"@

function Get-ErrorCode([int]$Win32Error) {
    switch ($Win32Error) {
        5 { return "permission-denied" }
        1801 { return "printer-not-found" }
        1797 { return "driver-error" }
        126 { return "driver-error" }
        default { return "print-job-failed" }
    }
}

$bytes = [System.IO.File]::ReadAllBytes($FilePath)
$result = [RawPrinterHelper]::SendBytes($PrinterName, $bytes)

if (-not $result.Success) {
    $errorPayload = @{
        code = Get-ErrorCode $result.Win32Error
        message = "Windows print job failed at $($result.Stage) for '$PrinterName'."
        details = @{
            stage = $result.Stage
            win32Error = $result.Win32Error
            bytesWritten = $result.BytesWritten
        }
    } | ConvertTo-Json -Compress
    [Console]::Error.WriteLine("JYAANO_PRINTER_ERROR=$errorPayload")
    exit 1
}

$successPayload = @{ jobId = $result.JobId } | ConvertTo-Json -Compress
Write-Output "JYAANO_PRINT_JOB=$successPayload"
