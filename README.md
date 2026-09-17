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

Windows 단일 실행 파일을 만들려면 다음을 실행합니다.

```powershell
npm.cmd run package:win
```

생성 결과:

```text
dist\ChromeHelper.exe
```

생성된 exe는 Node.js 설치 없이 실행할 수 있습니다. Chrome은 별도로 설치되어 있어야 합니다. exe 실행 시 `127.0.0.1:4320` API가 시작되며, Chrome 디버깅 프로필은 다음 요청으로 별도 실행합니다.

```powershell
Invoke-RestMethod http://127.0.0.1:4320/api/chrome/launch -Method Post
```

Windows exe 다운로드: [GitHub Releases](https://github.com/okok7272/ChromeHelper/releases)

GitHub에서 exe를 만들려면 Actions의 `Package Windows executable` workflow를 수동 실행하거나 `v1.0.0` 같은 태그를 push합니다. 실행 결과의 `ChromeHelper-windows-x64` artifact 안에 `ChromeHelper.exe`가 생성됩니다.

Chrome과 ChromeHelper를 한 번에 준비하려면 다음 명령을 사용합니다. 이미 실행 중인 Chrome/CDP 또는 ChromeHelper가 있으면 중복 실행하지 않습니다.

```powershell
npm.cmd run start:standalone
```

ChromeHelper는 포트별 PID lock도 사용하므로 같은 포트에서 두 번째 인스턴스를 실행하면 명확한 오류를 표시합니다. `Ctrl+C`나 프로세스 종료 신호를 받으면 서버와 lock을 정리합니다. Chrome은 별도 프로세스이므로 ChromeHelper 종료 시 강제로 종료하지 않습니다.

실제 실행 중인 ChromeHelper를 사용자가 직접 점검하려면 다른 PowerShell에서 다음을 실행합니다.

```powershell
npm.cmd run smoke
```

DeskFlux host를 통한 경로를 점검하려면 다음처럼 주소를 바꿉니다.

```powershell
npm.cmd run smoke -- -BaseUrl http://127.0.0.1:4310
```

이 스모크 테스트는 health, CDP 상태, 탭 목록, JPEG 스크린샷만 확인하며 클릭이나 키 입력은 보내지 않습니다. 결과 이미지 경로를 출력하므로 직접 열어 화면을 확인할 수 있습니다.

Windows 로그인 때 자동으로 시작하려면 관리자 권한 없이 다음을 실행합니다.

```powershell
npm.cmd run startup:install
```

등록된 작업은 로그인 시 `start:standalone`을 실행하고, 프로세스가 종료되면 최대 3회 재시작합니다. 자동 시작을 해제하려면 다음을 실행합니다.

```powershell
npm.cmd run startup:remove
```

ChromeHelper만 실행해도 Chrome 제어 API가 동작합니다. DeskFlux나 AWS는 필요하지 않습니다. Chrome공유는 필요할 때 같은 PC의 이 API를 호출하고, 휴대폰 통신과 사용자 화면은 Chrome공유가 담당합니다.

## Chrome공유 PC 호출 연결

Chrome공유의 PC 측 서버가 직접 호출할 때는 `http://127.0.0.1:4320/api/chrome/*`를 사용합니다. DeskFlux host 같은 PC 측 중계 서버를 사용하는 경우에는 중계 서버의 `/api/chrome/*` 경로를 호출하고, 중계 서버가 이 주소로 전달합니다. 휴대폰은 ChromeHelper 포트에 직접 접속하지 않습니다.

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

이미 CDP에 연결된 Chrome이 있으면 새 프로세스를 만들지 않고 `alreadyRunning: true`를 반환합니다.

응답:

```json
{ "started": false, "alreadyRunning": true, "cdpPort": 9222 }
```

성공 상태: `202`

### `GET /api/chrome/status`

Chrome CDP 연결 상태를 확인합니다. Chrome이 꺼져 있어도 상태 확인 자체는 성공합니다.

```json
{ "connected": true, "cdpPort": 9222, "mode": "local-bridge" }
```

성공 상태: `200`

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

Windows exe 빌드 및 실제 Chrome 자동 검증:

```powershell
npm.cmd ci
npm.cmd run package:win
node tools/verify-exe.mjs
```

빌드에는 Node.js 24를 사용합니다. 결과물은 `dist/ChromeHelper.exe`이며 실행 시 별도 Node.js 설치가 필요하지 않습니다. Chrome은 설치되어 있어야 합니다.

검증 스크립트는 exe만 임시 폴더에 복사하고 Node.js를 PATH에서 제외한 상태로 실행합니다. 별도 임시 프로필의 headless Chrome에서 상태 조회, 탭 조회, 클릭, 문자 입력, JPEG 캡처를 확인하고 테스트 프로세스를 종료합니다. 스크린샷은 `dist/verification.jpg`에 저장됩니다. 이 검증은 휴대폰이나 DeskFlux 전체 통합 테스트를 포함하지 않습니다.

ChromeHelper만 테스트할 때는 Chrome CDP와 ChromeHelper만 실행합니다.

가장 간단한 실행 방법은 다음과 같습니다.

```powershell
npm.cmd run start:standalone
```

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
