[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$SourceIcon,
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"

try {
  Add-Type -AssemblyName System.Drawing
  New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
  $source = [System.Drawing.Image]::FromFile($SourceIcon)
  try {
    foreach ($size in 44, 150) {
      $bitmap = New-Object System.Drawing.Bitmap $size, $size
      try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
          $graphics.Clear([System.Drawing.Color]::Transparent)
          $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
          $graphics.DrawImage($source, 0, 0, $size, $size)
          $bitmap.Save((Join-Path $OutputDirectory "Square${size}x${size}Logo.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
          $graphics.Dispose()
        }
      } finally {
        $bitmap.Dispose()
      }
    }
  } finally {
    $source.Dispose()
  }
} catch {
  throw "Could not generate required exact-size MSIX visual assets using Windows System.Drawing: $($_.Exception.Message)"
}
