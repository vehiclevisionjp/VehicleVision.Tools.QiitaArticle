<#
.SYNOPSIS
予約投稿記事を作成するスクリプト

.PARAMETER Date
投稿予定日（YYYY-MM-DD形式）

.PARAMETER Title
記事タイトル（英数字・ハイフン推奨）
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$Date,

    [Parameter(Mandatory = $true)]
    [string]$Title
)

$ErrorActionPreference = "Stop"

# 日付バリデーション: 明日以降であること
$parsedDate = [DateTime]::ParseExact($Date, 'yyyy-MM-dd', $null)
$tomorrow = (Get-Date).Date.AddDays(1)
if ($parsedDate -lt $tomorrow) {
    Write-Host "❌ 予約投稿日は明日以降を指定してください（指定: $Date）" -ForegroundColor Red
    exit 1
}

# 日付を yyyyMMdd 形式に変換
$dateForFile = $Date -replace '-', ''

# ファイル名に使えない文字を置換（スペース→アンダースコア、不正文字→ハイフン）
$safeTitle = $Title -replace '\s+', '_' -replace '[<>:"\/\\|?*]+', '-' -replace '-{2,}', '-' -replace '_{2,}', '_'
$safeTitle = $safeTitle.Trim('-', '.', '_')
$slug = "$dateForFile-$safeTitle"

# YYYY/MM サブディレクトリを計算
$year = $dateForFile.Substring(0, 4)
$month = $dateForFile.Substring(4, 2)
$subDir = "public/$year/$month"
$file = "$subDir/$slug.md"

# main ブランチに切り替えて最新化
git checkout main
git pull

# ブランチ名に使えない文字をハイフンに置換
$safeBranchSlug = $slug -replace '[\s~^:?*\[\]\\@{}]', '-' -replace '\.{2,}', '-' -replace '-{2,}', '-'
$safeBranchSlug = $safeBranchSlug.Trim('-', '.', '/')

# ブランチを作成
git checkout -b "add-$safeBranchSlug"

# 記事ファイルを作成（qiita new は public/ 直下に生成する）
npx qiita new $slug

# サブディレクトリに移動
if (-not (Test-Path $subDir)) {
    New-Item -Path $subDir -ItemType Directory -Force | Out-Null
}
Move-Item -Path "public/$slug.md" -Destination $file

# Front Matter を予約投稿用に変更
$content = Get-Content $file -Raw
$content = $content -replace 'ignorePublish: false', @"
ignorePublish: true
scheduled_publish: "$Date"
"@
Set-Content $file -Value $content -NoNewline

Write-Host "✅ 予約投稿記事を作成しました: $file (投稿予定日: $Date)" -ForegroundColor Green
