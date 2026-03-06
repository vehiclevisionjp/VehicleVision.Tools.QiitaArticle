<#
.SYNOPSIS
記事ファイル名の日付プレフィックスを、Front Matter の情報に基づいて同期するスクリプト

.DESCRIPTION
以下の2つのケースでファイル名の日付部分(YYYYMMDD)をリネームします:

1. 予約投稿記事（ignorePublish: true + scheduled_publish あり）
   → ファイル名の日付を scheduled_publish の日付に合わせる

2. 投稿済み記事（id が設定済み + created_at あり）
   → ファイル名の日付を created_at の日付（ローカル時刻）に合わせる
   ※ created_at がない場合は updated_at にフォールバック

.PARAMETER DryRun
実際にはリネームせず、変更内容のみ表示する

.PARAMETER Force
確認プロンプトなしで実行する

.EXAMPLE
.\scripts\Sync-ArticleDates.ps1
.\scripts\Sync-ArticleDates.ps1 -DryRun
.\scripts\Sync-ArticleDates.ps1 -Force
#>
param(
    [switch]$DryRun,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$publicDir = Join-Path $PSScriptRoot "..\public"

if (-not (Test-Path $publicDir)) {
    Write-Host "❌ public/ ディレクトリが見つかりません" -ForegroundColor Red
    exit 1
}

# Front Matter をパースする関数
function Get-FrontMatter {
    param([string]$FilePath)

    $content = Get-Content -LiteralPath $FilePath -Raw -Encoding UTF8
    $lines = $content -split "`n"
    $fields = @{}

    if ($lines.Count -eq 0 -or $lines[0].Trim() -ne '---') {
        return $fields
    }

    for ($i = 1; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        if ($line.Trim() -eq '---') { break }

        if ($line -match '^(\w[\w_]*)\s*:\s*(.*)$') {
            $key = $Matches[1].ToLower()
            $value = $Matches[2].Trim() -replace "^['""]|['""]$", ''
            $fields[$key] = $value
        }
    }

    return $fields
}

# updated_at / created_at から日付部分を抽出する関数（ローカル時刻に変換）
function Get-DateFromTimestamp {
    param([string]$Timestamp)

    if (-not $Timestamp -or $Timestamp -eq 'null' -or $Timestamp -eq '') {
        return $null
    }

    try {
        $dt = [DateTimeOffset]::Parse($Timestamp)
        $localDate = $dt.LocalDateTime.ToString('yyyy-MM-dd')
        return $localDate
    }
    catch {
        return $null
    }
}

# scheduled_publish から日付を取得する関数
function Get-DateFromScheduledPublish {
    param([string]$ScheduledPublish)

    if (-not $ScheduledPublish -or $ScheduledPublish -eq 'null' -or $ScheduledPublish -eq '') {
        return $null
    }

    if ($ScheduledPublish -match '^\d{4}-\d{2}-\d{2}$') {
        return $ScheduledPublish
    }

    return $null
}

# 処理開始
$files = Get-ChildItem -Path $publicDir -Filter "*.md" -Recurse |
    Where-Object { $_.FullName -notlike '*\.remote\*' } | Sort-Object Name
$renames = @()

foreach ($file in $files) {
    $fileName = $file.BaseName

    # ファイル名のパターンチェック: YYYYMMDD-タイトル
    if ($fileName -notmatch '^(\d{8})-(.+)$') {
        continue
    }

    $currentDateStr = $Matches[1]
    $titlePart = $Matches[2]

    # 日付未定記事（99999999）はスキップ
    if ($currentDateStr -eq '99999999') {
        continue
    }

    $fm = Get-FrontMatter -FilePath $file.FullName

    $id = $fm['id']
    $ignorePublish = $fm['ignorepublish']
    $scheduledPublish = $fm['scheduled_publish']
    $createdAt = $fm['created_at']
    $updatedAt = $fm['updated_at']

    $newDate = $null
    $reason = ''

    # ケース1: 予約投稿記事（ignorePublish: true + scheduled_publish あり）
    if ($ignorePublish -eq 'true' -and $scheduledPublish) {
        $spDate = Get-DateFromScheduledPublish -ScheduledPublish $scheduledPublish
        if ($spDate) {
            $newDateForFile = $spDate -replace '-', ''
            if ($newDateForFile -ne $currentDateStr) {
                $newDate = $newDateForFile
                $reason = "scheduled_publish: $spDate"
            }
        }
    }
    # ケース2: 投稿済み記事（id が設定済み）
    elseif ($id -and $id -ne 'null') {
        # created_at を優先、なければ updated_at にフォールバック
        $sourceTimestamp = if ($createdAt) { $createdAt } else { $updatedAt }
        $sourceLabel = if ($createdAt) { 'created_at' } else { 'updated_at' }
        $pubDate = Get-DateFromTimestamp -Timestamp $sourceTimestamp
        if ($pubDate) {
            $newDateForFile = $pubDate -replace '-', ''
            if ($newDateForFile -ne $currentDateStr) {
                $newDate = $newDateForFile
                $reason = "${sourceLabel}: $sourceTimestamp → $pubDate"
            }
        }
    }

    if ($newDate) {
        $newSlug = "$newDate-$titlePart"
        # 新しい日付に基づく YYYY/MM サブディレクトリ
        $newYear = $newDate.Substring(0, 4)
        $newMonth = $newDate.Substring(4, 2)
        $newDir = Join-Path $publicDir "$newYear\$newMonth"
        $newPath = Join-Path $newDir "$newSlug.md"

        # 移動先に同名ファイルがないか確認
        if ((Test-Path $newPath) -and $file.FullName -ne $newPath) {
            Write-Host "⚠️  スキップ: $fileName → $newSlug （移動先に同名ファイルが存在）" -ForegroundColor Yellow
            continue
        }

        $renames += [PSCustomObject]@{
            OldName   = $file.Name
            NewName   = "$newYear/$newMonth/$newSlug.md"
            OldPath   = $file.FullName
            NewPath   = $newPath
            Reason    = $reason
        }
    }
}

if ($renames.Count -eq 0) {
    Write-Host "✅ すべてのファイル名が日付と一致しています。変更の必要はありません。" -ForegroundColor Green
    exit 0
}

# 変更一覧を表示
Write-Host ""
Write-Host "📋 変更対象: $($renames.Count) 件" -ForegroundColor Cyan
Write-Host ""

foreach ($r in $renames) {
    Write-Host "  $($r.OldName)" -ForegroundColor White -NoNewline
    Write-Host " → " -ForegroundColor DarkGray -NoNewline
    Write-Host "$($r.NewName)" -ForegroundColor Green -NoNewline
    Write-Host "  ($($r.Reason))" -ForegroundColor DarkGray
}

Write-Host ""

if ($DryRun) {
    Write-Host "ℹ️  DryRun モードのため、実際のリネームは行いません。" -ForegroundColor Yellow
    exit 0
}

# 確認プロンプト
if (-not $Force) {
    $answer = Read-Host "上記のファイルをリネームしますか？ (y/N)"
    if ($answer -ne 'y' -and $answer -ne 'Y') {
        Write-Host "キャンセルしました。" -ForegroundColor Yellow
        exit 0
    }
}

# リネーム実行
$successCount = 0
foreach ($r in $renames) {
    try {
        # 移動先ディレクトリを作成（日付変更でサブディレクトリが変わる場合）
        $destDir = Split-Path $r.NewPath -Parent
        if (-not (Test-Path $destDir)) {
            New-Item -Path $destDir -ItemType Directory -Force | Out-Null
        }
        Move-Item -LiteralPath $r.OldPath -Destination $r.NewPath -ErrorAction Stop
        Write-Host "  ✅ $($r.OldName) → $($r.NewName)" -ForegroundColor Green
        $successCount++
    }
    catch {
        Write-Host "  ❌ $($r.OldName): $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "✅ $successCount 件のファイルをリネームしました。" -ForegroundColor Green
