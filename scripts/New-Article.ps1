<#
.SYNOPSIS
新規記事を作成するスクリプト（ブランチ付き）

.PARAMETER Title
記事スラッグ（英数字・日本語・ハイフン推奨）

.PARAMETER Visibility
公開設定（public / private）デフォルト: public
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$Title,

    [Parameter(Mandatory = $false)]
    [ValidateSet('public', 'private')]
    [string]$Visibility = 'public'
)

$ErrorActionPreference = "Stop"

# 今日の日付を yyyyMMdd 形式で取得
$date = Get-Date -Format 'yyyyMMdd'

# ファイル名に使えない文字を置換（スペース→アンダースコア、不正文字→ハイフン）
$safeTitle = $Title -replace '\s+', '_' -replace '[<>:"\/\\|?*]+', '-' -replace '-{2,}', '-' -replace '_{2,}', '_'
$safeTitle = $safeTitle.Trim('-', '.', '_')
$slug = "$date-$safeTitle"

# YYYY/MM サブディレクトリを計算
$year = $date.Substring(0, 4)
$month = $date.Substring(4, 2)
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

# Front Matter を更新
$content = Get-Content $file -Raw
$content = $content -replace 'ignorePublish: false', 'ignorePublish: true'
if ($Visibility -eq 'private') {
    $content = $content -replace 'private: false', 'private: true'
}
Set-Content $file -Value $content -NoNewline

$visLabel = if ($Visibility -eq 'private') { '限定共有' } else { '公開' }
Write-Host "✅ ${visLabel}記事を作成しました: $file" -ForegroundColor Green
