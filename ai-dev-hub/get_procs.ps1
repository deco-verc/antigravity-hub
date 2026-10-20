Get-CimInstance Win32_Process -Filter "Name = 'Antigravity.exe'" | Select-Object ProcessId, ParentProcessId, CommandLine | Format-List
