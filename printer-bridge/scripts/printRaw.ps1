
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
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pDocName;

        [MarshalAs(UnmanagedType.LPWStr)]
        public string pOutputFile;

        [MarshalAs(UnmanagedType.LPWStr)]
        public string pDataType;
    }

    [DllImport("winspool.drv",
        EntryPoint = "OpenPrinterW",
        SetLastError = true,
        CharSet = CharSet.Unicode)]
    public static extern bool OpenPrinter(
        string printerName,
        out IntPtr printerHandle,
        IntPtr printerDefaults
    );

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool ClosePrinter(
        IntPtr printerHandle
    );

    [DllImport("winspool.drv",
        EntryPoint = "StartDocPrinterW",
        SetLastError = true,
        CharSet = CharSet.Unicode)]
    public static extern int StartDocPrinter(
        IntPtr printerHandle,
        int level,
        [In] DOCINFO docInfo
    );

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndDocPrinter(
        IntPtr printerHandle
    );

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool StartPagePrinter(
        IntPtr printerHandle
    );

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndPagePrinter(
        IntPtr printerHandle
    );

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool WritePrinter(
        IntPtr printerHandle,
        IntPtr bytes,
        int count,
        out int written
    );

    public static bool SendBytes(string printerName, byte[] bytes)
    {
        IntPtr printerHandle;

        if (!OpenPrinter(printerName, out printerHandle, IntPtr.Zero))
            return false;

        DOCINFO docInfo = new DOCINFO();
        docInfo.pDocName = "Inventory Receipt";
        docInfo.pDataType = "RAW";

        int jobId = StartDocPrinter(
            printerHandle,
            1,
            docInfo
        );

        if (jobId == 0)
        {
            ClosePrinter(printerHandle);
            return false;
        }

        StartPagePrinter(printerHandle);

        IntPtr unmanagedBytes =
            Marshal.AllocCoTaskMem(bytes.Length);

        Marshal.Copy(
            bytes,
            0,
            unmanagedBytes,
            bytes.Length
        );

        int written;

        bool success = WritePrinter(
            printerHandle,
            unmanagedBytes,
            bytes.Length,
            out written
        );

        Marshal.FreeCoTaskMem(unmanagedBytes);

        EndPagePrinter(printerHandle);
        EndDocPrinter(printerHandle);
        ClosePrinter(printerHandle);

        return success && written == bytes.Length;
    }
}
"@

$bytes = [System.IO.File]::ReadAllBytes($FilePath)

$success = [RawPrinterHelper]::SendBytes(
    $PrinterName,
    $bytes
)

if (-not $success) {
    throw "Unable to send RAW receipt data to printer '$PrinterName'."
}

Write-Output "Receipt sent to $PrinterName"

