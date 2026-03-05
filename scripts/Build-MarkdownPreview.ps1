<#
.SYNOPSIS
    Qiita Markdown Preview 拡張機能をビルド＆インストールするスクリプト。
    ビルド日時からバージョン番号を自動生成する（YYYY.MMDD.HHmm 形式）。

.PARAMETER SkipBuild
    TypeScript のビルド（esbuild）をスキップし、パッケージングとインストールのみ行う。

.PARAMETER InstallOnly
    既存の .vsix ファイルをそのままインストールする。ビルド・パッケージング・バージョン更新をすべてスキップする。

.PARAMETER DryRun
    バージョン変更のみ表示し、実際のビルド・インストールは行わない。

.EXAMPLE
    # ビルド＆インストール（通常）
    .\scripts\Build-MarkdownPreview.ps1

    # ビルドなし（パッケージング＆インストールのみ）
    .\scripts\Build-MarkdownPreview.ps1 -SkipBuild

    # 既存 vsix をインストールのみ
    .\scripts\Build-MarkdownPreview.ps1 -InstallOnly
#>
param(
    [switch]$SkipBuild,
    [switch]$InstallOnly,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$extensionDir = Join-Path $PSScriptRoot '..\extensions\markdown-preview'
$vsixFile = 'VehicleVision.Tools.QiitaArticle.MarkdownPreview.vsix'

# -InstallOnly: 既存 vsix をそのままインストール
if ($InstallOnly) {
    $vsixPath = Join-Path $extensionDir $vsixFile
    if (-not (Test-Path $vsixPath)) {
        throw "vsix ファイルが見つかりません: $vsixPath`nビルド＆インストールタスクを先に実行してください。"
    }
    Write-Host "既存の vsix をインストール中: $vsixFile" -ForegroundColor Green
    Push-Location $extensionDir
    try {
        code.cmd --install-extension $vsixFile --force
        if ($LASTEXITCODE -ne 0) { throw 'インストールに失敗しました。' }
        Write-Host '完了: インストールしました。' -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
    exit 0
}

$packageJsonPath = Join-Path $extensionDir 'package.json'

# package.json を読み込み
$packageJson = Get-Content -Path $packageJsonPath -Raw | ConvertFrom-Json
$currentVersion = $packageJson.version

# ビルド日時からバージョンを生成（YYYY.MMDD.HHmm）
$now = Get-Date
$newVersion = '{0}.{1}.{2}' -f $now.ToString('yyyy'), [int]$now.ToString('MMdd'), [int]$now.ToString('HHmm')

Write-Host "バージョン: $currentVersion -> $newVersion" -ForegroundColor Cyan

if ($DryRun) {
    Write-Host '[DryRun] 実際の変更は行いません。' -ForegroundColor Yellow
    exit 0
}

# package.json のバージョンを更新（JSON 構造を保持）
$rawContent = Get-Content -Path $packageJsonPath -Raw
$updatedContent = $rawContent -replace "`"version`":\s*`"$([regex]::Escape($currentVersion))`"", "`"version`": `"$newVersion`""
Set-Content -Path $packageJsonPath -Value $updatedContent -NoNewline

Push-Location $extensionDir

# npm install（node_modules がなければ実行）
$nodeModulesPath = Join-Path $extensionDir 'node_modules'
if (-not (Test-Path $nodeModulesPath)) {
    Write-Host 'npm install 実行中...' -ForegroundColor Green
    npm install
    if ($LASTEXITCODE -ne 0) { throw 'npm install に失敗しました。' }
}

# ビルド
try {
    if (-not $SkipBuild) {
        Write-Host 'ビルド中...' -ForegroundColor Green
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'ビルドに失敗しました。' }
    }

    # パッケージング
    Write-Host 'パッケージング中...' -ForegroundColor Green
    # バージョン付きの古い vsix を先に削除
    Get-ChildItem -Path $extensionDir -Filter 'VehicleVision.Tools.QiitaArticle.MarkdownPreview-*.vsix' | Remove-Item -Force
    # 固定名の既存ファイルも削除
    $vsixPath = Join-Path $extensionDir $vsixFile
    if (Test-Path $vsixPath) { Remove-Item -Path $vsixPath -Force }
    npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository -o $vsixFile
    if ($LASTEXITCODE -ne 0) { throw 'パッケージングに失敗しました。' }

    # インストール
    Write-Host 'インストール中...' -ForegroundColor Green
    code.cmd --install-extension $vsixFile --force
    if ($LASTEXITCODE -ne 0) { throw 'インストールに失敗しました。' }

    Write-Host "完了: v$newVersion をインストールしました。" -ForegroundColor Green
}
finally {
    Pop-Location
}
