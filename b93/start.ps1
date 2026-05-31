# 调用链分析平台启动脚本

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  调用链分析平台 - Trace Analysis Platform" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$backendPath = Join-Path $PSScriptRoot "backend"

Write-Host "[1/6] 启动 API 服务 (端口 8080)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit -Command Set-Location '$backendPath'; go run api/main.go" -WindowStyle Minimized

Start-Sleep -Seconds 2

Write-Host "[2/6] 启动订单服务 (端口 8081)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit -Command Set-Location '$backendPath'; go run order/main.go" -WindowStyle Minimized

Start-Sleep -Seconds 2

Write-Host "[3/6] 启动库存服务 (端口 8082)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit -Command Set-Location '$backendPath'; go run inventory/main.go" -WindowStyle Minimized

Start-Sleep -Seconds 2

Write-Host "[4/6] 启动支付服务 (端口 8083)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit -Command Set-Location '$backendPath'; go run payment/main.go" -WindowStyle Minimized

Start-Sleep -Seconds 3

Write-Host "[5/6] 启动前端服务 (端口 3000)..." -ForegroundColor Yellow
$frontendPath = Join-Path $PSScriptRoot "frontend"
Start-Process powershell -ArgumentList "-NoExit -Command Set-Location '$frontendPath'; npx serve -p 3000" -WindowStyle Minimized

Start-Sleep -Seconds 3

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  所有服务已启动!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "服务地址:" -ForegroundColor Cyan
Write-Host "  - 前端界面:     http://localhost:3000" -ForegroundColor White
Write-Host "  - API服务:      http://localhost:8080" -ForegroundColor White
Write-Host "  - 订单服务:     http://localhost:8081" -ForegroundColor White
Write-Host "  - 库存服务:     http://localhost:8082" -ForegroundColor White
Write-Host "  - 支付服务:     http://localhost:8083" -ForegroundColor White
Write-Host ""
Write-Host "Jaeger 链路追踪 (需要单独启动):" -ForegroundColor Cyan
Write-Host "  docker run -d --name jaeger -p 16686:16686 -p 4317:4317 -p 4318:4318 jaegertracing/all-in-one:1.51" -ForegroundColor Gray
Write-Host ""
Write-Host "按任意键打开前端界面..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
Start-Process "http://localhost:3000"
