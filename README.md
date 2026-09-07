# ChromeHelper

DeskFlux와 독립적으로 실행되는 Chrome 전용 로컬 제어 프로그램입니다.

## 실행

```powershell
npm.cmd install
npm.cmd run dev
```

배포 빌드로 실행하려면 다음과 같이 합니다.

```powershell
npm.cmd run build
npm.cmd start
```

ChromeHelper만 실행해도 Chrome 제어 API가 동작합니다. DeskFlux나 AWS는 필요하지 않습니다. Chrome공유는 필요할 때 같은 PC의 이 API를 호출하고, 휴대폰 통신과 사용자 화면은 Chrome공유가 담당합니다.

Chrome을 별도 디버깅 프로필로 시작하려면 이 프로젝트의 `tools/launch-chrome.ps1`를 실행하거나 다음 옵션으로 실행합니다.

```text
--remote-debugging-port=9222
--user-data-dir=%TEMP%\\DeskFluxChrome
```

## API

Chrome공유는 아래 로컬 API만 호출합니다. 모든 경로의 기본 주소는 `http://127.0.0.1:4320`입니다.

### `GET /api/chrome/tabs`

Chrome CDP의 page 탭 목록을 반환합니다.

```json
[
	{
		"id": "tab-id",
		"type": "page",
		"title": "Example Domain",
		"url": "https://example.com/",
		"webSocketDebuggerUrl": "ws://127.0.0.1:9222/devtools/page/tab-id"
	}
]
```

성공 상태: `200`

### `POST /api/chrome/launch`

ChromeHelper 전용 디버깅 프로필로 Chrome을 시작합니다.

응답:

```json
{ "started": true, "cdpPort": 9222 }
```

성공 상태: `202`

### `GET /api/chrome/tabs/:tabId/screenshot`

지정한 탭의 현재 화면을 JPEG 이미지로 반환합니다. `tabId`는 URL 경로에 넣기 전에 URL 인코딩해야 합니다.

성공 상태: `200`, `Content-Type: image/jpeg`

### `POST /api/chrome/tabs/:tabId/input`

지정한 탭에 마우스 또는 키보드 이벤트를 보냅니다.

마우스 입력:

```json
{ "type": "click", "x": 300, "y": 200 }
```

`type`은 `click`, `doubleClick`, `rightClick` 중 하나이며 좌표는 Chrome viewport 기준 픽셀입니다.

키 입력:

```json
{ "type": "key", "key": "a" }
```

성공 응답:

```json
{ "sent": true }
```

성공 상태: `200`

잘못된 입력: `400`, Chrome/CDP 연결 실패: `503`

공통 오류 응답:

```json
{ "error": "설명" }
```

루트 `GET /`는 연결 확인용으로 다음을 반환합니다.

```json
{ "service": "chrome-helper", "status": "ok", "mode": "local-bridge" }
```

이 프로그램은 `127.0.0.1`에만 바인딩되며 AWS나 외부 서버가 필요하지 않습니다. Chrome공유는 이 API를 같은 PC에서 `http://127.0.0.1:4320`으로 호출해야 합니다. CDP 포트 `9222`는 외부 네트워크에 공개하면 안 됩니다.

## ChromeHelper 단독 테스트

ChromeHelper만 테스트할 때는 Chrome CDP와 ChromeHelper만 실행합니다.

```powershell
.\tools\launch-chrome.ps1
npm.cmd run dev
```

다른 PowerShell에서 다음을 실행합니다.

```powershell
$tabs = Invoke-RestMethod http://127.0.0.1:4320/api/chrome/tabs
$tab = @($tabs) | Where-Object type -eq "page" | Select-Object -First 1

Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 `
	"http://127.0.0.1:4320/api/chrome/tabs/$($tab.id)/screenshot" `
	-OutFile "$env:TEMP\chrome-helper-test.jpg"

Invoke-Item "$env:TEMP\chrome-helper-test.jpg"
```

클릭과 키 입력도 ChromeHelper에 직접 보낼 수 있습니다.

```powershell
$body = @{ type = "click"; x = 300; y = 200 } | ConvertTo-Json
Invoke-RestMethod "http://127.0.0.1:4320/api/chrome/tabs/$($tab.id)/input" -Method Post -ContentType "application/json" -Body $body

$body = @{ type = "key"; key = "a" } | ConvertTo-Json
Invoke-RestMethod "http://127.0.0.1:4320/api/chrome/tabs/$($tab.id)/input" -Method Post -ContentType "application/json" -Body $body
```
