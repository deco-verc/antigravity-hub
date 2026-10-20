$ErrorActionPreference='Stop'
# Read only the GUI's user-data-dir flag. Never read the Language Server command line.
$items = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('Antigravity.exe','language_server.exe','DecoHUB.exe') })
$safe = @($items | ForEach-Object {
    $ud=$null
    if ($_.Name -eq 'Antigravity.exe') {
        $m=[regex]::Match($_.CommandLine,'(?:^|\s)(?:"--user-data-dir=([^"]+)"|--user-data-dir(?:=|\s+)(?:"([^"]+)"|([^\s"]+)))')
        if ($m.Success) { foreach($g in 1..3) { if($m.Groups[$g].Success) { $ud=$m.Groups[$g].Value; break } } }
    }
    [PSCustomObject]@{pid=$_.ProcessId;parentPid=$_.ParentProcessId;name=$_.Name;executable=$_.ExecutablePath;started=$_.CreationDate.ToString('o');userDataDir=$ud}
})
ConvertTo-Json -InputObject $safe -Compress -Depth 3
