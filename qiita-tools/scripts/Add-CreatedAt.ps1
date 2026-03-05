<#
.SYNOPSIS
投稿済み記事の Front Matter に created_at を Qiita API から取得して追加するスクリプト

.DESCRIPTION
Qiita CLI の認証情報（~/.config/qiita-cli/credentials.json）を使用し、
id が設定済みで created_at がない記事に対して Qiita API から created_at を取得して追加します。

.PARAMETER DryRun
実際には書き込まず、取得した created_at のみ表示する

.EXAMPLE
.\scripts\Add-CreatedAt.ps1
.\scripts\Add-CreatedAt.ps1 -DryRun
#>
param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$publicDir = Join-Path $PSScriptRoot "..\public"

if (-not (Test-Path $publicDir)) {
    Write-Host "❌ public/ ディレクトリが見つかりません" -ForegroundColor Red
    exit 1
}

# Qiita トークン取得
$credentialPath = Join-Path $env:USERPROFILE ".config\qiita-cli\credentials.json"
if (-not (Test-Path $credentialPath)) {
    Write-Host "❌ Qiita CLI の認証情報が見つかりません: $credentialPath" -ForegroundColor Red
    Write-Host "   npx qiita login でログインしてください" -ForegroundColor Yellow
    exit 1
}

$credentials = Get-Content $credentialPath -Raw | ConvertFrom-Json
$defaultName = $credentials.default
# credentials 配列から default 名に一致するエントリを検索
$entry = $credentials.credentials | Where-Object { $_.name -eq $defaultName } | Select-Object -First 1
if ($entry -and $entry.accessToken) {
    $token = $entry.accessToken
} else {
    # フォールバック: 最初のエントリ
    $first = $credentials.credentials | Select-Object -First 1
    if ($first) { $token = $first.accessToken }
}
if (-not $token) {
    Write-Host "❌ トークンを取得できませんでした" -ForegroundColor Red
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

# 処理開始
$files = Get-ChildItem -Path $publicDir -Filter "*.md" -Recurse |
    Where-Object { $_.FullName -notlike '*\.remote\*' } | Sort-Object Name
$updated = 0
$skipped = 0
$errors = 0

foreach ($file in $files) {
    $fm = Get-FrontMatter -FilePath $file.FullName

    $id = $fm['id']
    $createdAt = $fm['created_at']

    # id がない記事はスキップ
    if (-not $id -or $id -eq 'null') {
        continue
    }

    # created_at が既にある記事はスキップ
    if ($createdAt -and $createdAt -ne '' -and $createdAt -ne 'null') {
        $skipped++
        continue
    }

    # Qiita API から created_at を取得
    try {
        $headers = @{
            'Authorization' = "Bearer $token"
        }
        # Invoke-WebRequest で生 JSON を取得し、正規表現で created_at を抽出（DateTime 自動変換を回避）
        $rawResponse = Invoke-WebRequest -Uri "https://qiita.com/api/v2/items/$id" -Headers $headers -Method Get -UseBasicParsing
        if ($rawResponse.Content -match '"created_at"\s*:\s*"([^"]+)"') {
            $apiCreatedAt = $Matches[1]
        } else {
            $apiCreatedAt = $null
        }
        if (-not $apiCreatedAt) {
            Write-Host "  ⚠️  $($file.Name): created_at を取得できませんでした" -ForegroundColor Yellow
            $errors++
            continue
        }

        Write-Host "  $($file.Name)" -ForegroundColor White -NoNewline
        Write-Host " → created_at: $apiCreatedAt" -ForegroundColor Green

        if (-not $DryRun) {
            # Front Matter に created_at を追加（updated_at の次の行）
            $content = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
            $content = $content -replace "(updated_at:\s*[^\r\n]+)", "`$1`ncreated_at: '$apiCreatedAt'"
            Set-Content -LiteralPath $file.FullName -Value $content -NoNewline -Encoding UTF8
        }

        $updated++

        # API レート制限対策（1秒待機）
        Start-Sleep -Seconds 1

    } catch {
        Write-Host "  ❌ $($file.Name): API エラー - $_" -ForegroundColor Red
        $errors++
    }
}

Write-Host ""
if ($DryRun) {
    Write-Host "ℹ️  DryRun モード: $updated 件の記事に created_at を追加予定（スキップ: $skipped 件、エラー: $errors 件）" -ForegroundColor Yellow
} else {
    Write-Host "✅ $updated 件の記事に created_at を追加しました（スキップ: $skipped 件、エラー: $errors 件）" -ForegroundColor Green
}
