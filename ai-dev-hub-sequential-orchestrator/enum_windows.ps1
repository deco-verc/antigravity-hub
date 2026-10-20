Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  using System.Text;
  using System.Collections.Generic;

  public class WinEnum {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    public static List<string> GetAllVisibleWindows() {
        var list = new List<string>();
        EnumWindows((hWnd, lParam) => {
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            bool visible = IsWindowVisible(hWnd);
            if (visible) {
                StringBuilder sb = new StringBuilder(256);
                GetWindowText(hWnd, sb, 256);
                string title = sb.ToString();
                if (!string.IsNullOrEmpty(title) && title.Length > 2) {
                    list.Add(string.Format("PID: {0}, Title: '{1}'", pid, title));
                }
            }
            return true;
        }, IntPtr.Zero);
        return list;
    }
  }
"@

$wins = [WinEnum]::GetAllVisibleWindows()
foreach ($w in $wins) {
  Write-Host $w
}
