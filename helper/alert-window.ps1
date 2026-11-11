param(
  [Parameter(Mandatory = $true)][string]$AlertFile,
  [Parameter(Mandatory = $true)][string]$StopFile,
  [Parameter(Mandatory = $true)][string]$JumpFile,
  [int]$OwnerPid = 0,
  [string]$LogFile = ''
)

# This script stays ASCII-only on purpose: Windows PowerShell 5.1 reads a .ps1
# without a BOM as ANSI, which would corrupt any non-ASCII literal. All copy
# (including translations) arrives in the UTF-8 alert document instead.

function Write-Log {
  param([string]$Message)
  if ([string]::IsNullOrEmpty($LogFile)) { return }
  try { Add-Content -LiteralPath $LogFile -Value ((Get-Date -Format o) + ' ' + $Message) -Encoding UTF8 } catch { }
}

# DPI awareness must be claimed before the process creates any window, otherwise
# Windows bitmap-scales the whole card and the text turns fuzzy on a scaled
# display (150% and up). Per-monitor v2 keeps text rendered at native pixels.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class AttentionDpi {
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] private static extern uint GetDpiForSystem();
    [DllImport("gdi32.dll")] private static extern int GetDeviceCaps(IntPtr hdc, int index);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr hWnd, IntPtr hdc);

    // -4 is DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2.
    public static void Enable() {
        try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch { }
        try { if (SetProcessDpiAwarenessContext(new IntPtr(-3))) return; } catch { }
        try { SetProcessDPIAware(); } catch { }
    }

    public static int SystemDpi() {
        try {
            uint dpi = GetDpiForSystem();
            if (dpi > 0) return (int)dpi;
        } catch { }
        try {
            IntPtr dc = GetDC(IntPtr.Zero);
            if (dc != IntPtr.Zero) {
                int dpi = GetDeviceCaps(dc, 88); // LOGPIXELSX
                ReleaseDC(IntPtr.Zero, dc);
                if (dpi > 0) return dpi;
            }
        } catch { }
        return 96;
    }
}
"@

[AttentionDpi]::Enable()

$script:dpi = [AttentionDpi]::SystemDpi()
$script:scale = $script:dpi / 96.0
Write-Log ('helper: dpi=' + $script:dpi + ' scale=' + $script:scale)

# Authoring units are DIPs at 96 DPI; every pixel value goes through this.
function S {
  param([double]$Value)
  return [int][Math]::Round($Value * $script:scale)
}

Write-Log 'helper: booting'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// A topmost card that never steals focus when it appears: clicking it still
// gives it focus, but an incoming alert does not interrupt typing elsewhere.
public class AttentionForm : Form {
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams {
        get {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= 0x00000008; // WS_EX_TOPMOST
            cp.ExStyle |= 0x00000080; // WS_EX_TOOLWINDOW: no alt-tab entry
            return cp;
        }
    }
}

public class AttentionNative {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
"@ -ReferencedAssemblies System.Windows.Forms, System.Drawing

# GDI text (TextRenderer) gives ClearType edges; the default GDI+ path renders
# softer at small sizes.
[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false)

$script:accentColor = [System.Drawing.Color]::FromArgb(224, 139, 26)
$script:questionColor = [System.Drawing.Color]::FromArgb(96, 132, 255)
$script:successColor = [System.Drawing.Color]::FromArgb(63, 185, 80)
$script:backgroundColor = [System.Drawing.Color]::FromArgb(26, 30, 41)
$script:titleColor = [System.Drawing.Color]::FromArgb(240, 242, 247)
$script:bodyColor = [System.Drawing.Color]::FromArgb(198, 205, 220)
$script:fontFamily = 'Microsoft YaHei UI'

$cardWidth = S 400
$cardHeight = S 184

$form = New-Object AttentionForm
$form.FormBorderStyle = 'None'
$form.StartPosition = 'Manual'
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.AutoScaleMode = 'None'
$form.Width = $cardWidth
$form.Height = $cardHeight
$form.BackColor = $script:backgroundColor
$form.Padding = New-Object System.Windows.Forms.Padding(0)
$form.Font = New-Object System.Drawing.Font($script:fontFamily, 9.5)

$accent = New-Object System.Windows.Forms.Panel
$accent.Dock = 'Left'
$accent.Width = (S 4)
$accent.BackColor = $script:accentColor
$form.Controls.Add($accent)

$kindLabel = New-Object System.Windows.Forms.Label
$kindLabel.AutoSize = $true
$kindLabel.Location = New-Object System.Drawing.Point((S 18), (S 14))
$kindLabel.Font = New-Object System.Drawing.Font($script:fontFamily, 9.5, [System.Drawing.FontStyle]::Bold)
$kindLabel.ForeColor = $script:accentColor
$kindLabel.UseMnemonic = $false
$form.Controls.Add($kindLabel)

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.AutoEllipsis = $true
$titleLabel.Location = New-Object System.Drawing.Point((S 18), (S 38))
$titleLabel.Size = New-Object System.Drawing.Size((S 364), (S 26))
$titleLabel.Font = New-Object System.Drawing.Font($script:fontFamily, 11.5, [System.Drawing.FontStyle]::Bold)
$titleLabel.ForeColor = $script:titleColor
$titleLabel.UseMnemonic = $false
$form.Controls.Add($titleLabel)

$bodyLabel = New-Object System.Windows.Forms.Label
$bodyLabel.Location = New-Object System.Drawing.Point((S 18), (S 68))
$bodyLabel.Size = New-Object System.Drawing.Size((S 364), (S 46))
$bodyLabel.Font = New-Object System.Drawing.Font($script:fontFamily, 9.5)
$bodyLabel.ForeColor = $script:bodyColor
$bodyLabel.UseMnemonic = $false
$form.Controls.Add($bodyLabel)

$openButton = New-Object System.Windows.Forms.Button
$openButton.Size = New-Object System.Drawing.Size((S 108), (S 30))
$openButton.Location = New-Object System.Drawing.Point((S 168), (S 134))
$openButton.FlatStyle = 'Flat'
$openButton.FlatAppearance.BorderSize = 0
$openButton.BackColor = $script:accentColor
$openButton.ForeColor = [System.Drawing.Color]::White
$openButton.Font = New-Object System.Drawing.Font($script:fontFamily, 9.5)
$openButton.Cursor = 'Hand'
$form.Controls.Add($openButton)

$dismissButton = New-Object System.Windows.Forms.Button
$dismissButton.Size = New-Object System.Drawing.Size((S 96), (S 30))
$dismissButton.Location = New-Object System.Drawing.Point((S 286), (S 134))
$dismissButton.FlatStyle = 'Flat'
$dismissButton.FlatAppearance.BorderSize = 0
$dismissButton.BackColor = [System.Drawing.Color]::FromArgb(45, 51, 66)
$dismissButton.ForeColor = $script:bodyColor
$dismissButton.Font = New-Object System.Drawing.Font($script:fontFamily, 9.5)
$dismissButton.Cursor = 'Hand'
$form.Controls.Add($dismissButton)

function Get-CardOrigin {
  $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  return New-Object System.Drawing.Point(($area.Right - $form.Width - (S 24)), ($area.Top + (S 24)))
}

$form.Location = Get-CardOrigin
$script:lastSeq = -1
$script:current = $null

# The page sends resolved theme colours (the helper cannot read CSS variables),
# so the card follows light/dark like the in-app one.
function ConvertTo-Color {
  param([string]$Value, [System.Drawing.Color]$Fallback)
  if ([string]::IsNullOrWhiteSpace($Value)) { return $Fallback }
  $text = $Value.Trim()
  if ($text.StartsWith('#')) {
    try { return [System.Drawing.ColorTranslator]::FromHtml($text) } catch { return $Fallback }
  }
  $match = [regex]::Match($text, 'rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)')
  if ($match.Success) {
    try {
      return [System.Drawing.Color]::FromArgb(
        [int][double]$match.Groups[1].Value,
        [int][double]$match.Groups[2].Value,
        [int][double]$match.Groups[3].Value)
    } catch { return $Fallback }
  }
  return $Fallback
}

function Show-Attention {
  param($Alert)
  $kind = [string]$Alert.kind
  $isQuestion = ($kind -eq 'question') -or ($kind -eq 'plan-review')
  $isDone = $kind -eq 'done'
  $kindColor = if ($isQuestion) { $script:questionColor } elseif ($isDone) { $script:successColor } else { $script:accentColor }
  $background = $script:backgroundColor
  $titleColor = $script:titleColor
  $bodyColor = $script:bodyColor
  $theme = $Alert.theme
  if ($null -ne $theme) {
    $kindColor = ConvertTo-Color ([string]$theme.accent) $kindColor
    $background = ConvertTo-Color ([string]$theme.bg) $background
    $titleColor = ConvertTo-Color ([string]$theme.text) $titleColor
    $bodyColor = ConvertTo-Color ([string]$theme.muted) $bodyColor
  }
  $kindText = [string]$Alert.kindLabel
  if ([string]::IsNullOrWhiteSpace($kindText)) {
    $kindText = if ($isQuestion) { 'Waiting for your choice' } else { 'Approval needed' }
  }
  $openText = [string]$Alert.openLabel
  if ([string]::IsNullOrWhiteSpace($openText)) { $openText = 'Open session' }
  $dismissText = [string]$Alert.dismissLabel
  if ([string]::IsNullOrWhiteSpace($dismissText)) { $dismissText = 'Dismiss' }
  $form.BackColor = $background
  $kindLabel.Text = $kindText
  $kindLabel.ForeColor = $kindColor
  $accent.BackColor = $kindColor
  $openButton.BackColor = $kindColor
  $openButton.Text = $openText
  $dismissButton.Text = $dismissText
  $titleLabel.ForeColor = $titleColor
  $bodyLabel.ForeColor = $bodyColor
  $titleLabel.Text = [string]$Alert.title
  $bodyLabel.Text = [string]$Alert.body
  $script:current = $Alert
  if (-not $form.Visible) {
    try {
      $form.Show()
      $form.Location = Get-CardOrigin
      Write-Log ('show: visible=' + $form.Visible + ' bounds=' + $form.Bounds)
    } catch {
      Write-Log ('show failed: ' + $_.Exception.Message)
    }
  }
}

$openButton.Add_Click({
  # Ask the page to switch sessions: the helper has no access to the app's
  # session controller, so it drops a request the page polls for.
  if ($null -ne $script:current) {
    $payload = @{
      sessionId = [string]$script:current.sessionId
      key       = [string]$script:current.key
    } | ConvertTo-Json -Compress
    try { Set-Content -LiteralPath $JumpFile -Value $payload -Encoding UTF8 } catch {
      Write-Log ('jump write failed: ' + $_.Exception.Message)
    }
  }
  $target = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($null -ne $target) {
    $handle = $target.MainWindowHandle
    # SW_RESTORE also un-maximizes a maximized window, which looks like the app
    # dropping out of fullscreen. Restore only a minimized window; otherwise
    # just raise whatever state it already has.
    if ([AttentionNative]::IsIconic($handle)) {
      [void][AttentionNative]::ShowWindow($handle, 9) # SW_RESTORE
    }
    [void][AttentionNative]::SetForegroundWindow($handle)
  }
  $form.Hide()
})

$dismissButton.Add_Click({ $form.Hide() })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 400
$timer.Add_Tick({
  if (Test-Path -LiteralPath $StopFile) {
    $timer.Stop()
    $form.Close()
    [System.Windows.Forms.Application]::Exit()
    return
  }
  if ($OwnerPid -gt 0) {
    $owner = Get-Process -Id $OwnerPid -ErrorAction SilentlyContinue
    if ($null -eq $owner) {
      $timer.Stop()
      $form.Close()
      [System.Windows.Forms.Application]::Exit()
      return
    }
  }
  try { $raw = Get-Content -LiteralPath $AlertFile -Raw -Encoding UTF8 -ErrorAction Stop } catch { return }
  if ([string]::IsNullOrWhiteSpace($raw)) { return }
  try { $alert = $raw | ConvertFrom-Json } catch { return }
  if ($null -eq $alert) { return }
  if ($alert.seq -eq $script:lastSeq) { return }
  $script:lastSeq = $alert.seq
  Write-Log ('tick: seq=' + $alert.seq + ' visible=' + $alert.visible)
  if ($alert.visible) {
    Show-Attention -Alert $alert
  } else {
    $form.Hide()
  }
})
$timer.Start()

# Run the loop without a main form: the card starts hidden and is shown only
# when an alert arrives, so no window flashes at startup.
[System.Windows.Forms.Application]::Run()
