# 📊 Buffett Flow Static — GitHub Pages 자동 갱신 버전

한국 코스피·코스닥 시장의 **기관 / 연기금 / 외국인 / 사모펀드** 매수·매도·순매수 상위 종목을 매일 자동 수집하여, **종목별 버핏식 간이 점수**와 함께 모바일·PC 어디서나 볼 수 있는 정적 웹사이트입니다.

- 🤖 매일 KST 19시에 GitHub Actions 가 자동 실행 → 데이터 갱신 → Pages 재배포
- 📱 모바일 반응형 (탭으로 시장/기간/투자자/매매종류 전환)
- 🆓 GitHub 무료 플랜으로 완전히 무료 운영 가능
- 🖥️ **PC 안 켜도 됨** — 클라우드에서 알아서 갱신

---

## 🚀 처음 설정하기 (10분이면 끝)

### 0단계 — 사전 준비

다음 두 가지가 필요합니다:

1. **GitHub 계정** (없으면 https://github.com/signup 에서 무료 가입)
2. **KRX Data Marketplace 계정** — pykrx 가 KRX 로 로그인하기 위해 필요
   - https://data.krx.co.kr 에서 **일반 회원가입** (네이버/카카오 ❌, 자체 ID/PW ✅)
   - 무료

---

### 1단계 — GitHub 에 저장소 만들기

1. GitHub 로그인 후 우측 상단 **+** → **New repository**
2. **Repository name**: `buffett-flow` (원하는 이름)
3. **Public** 선택 (GitHub Pages 무료 사용을 위해 권장)
4. **Add a README file**, **.gitignore**, **license** 등은 모두 체크하지 않음 (빈 저장소)
5. **Create repository** 클릭

### 2단계 — 본 폴더의 파일을 저장소에 올리기

#### 방법 A: GitHub 웹에서 드래그&드롭 (가장 쉬움)

1. 방금 만든 빈 저장소 페이지 상단의 **"uploading an existing file"** 링크 클릭
2. 본 폴더(`buffett-flow-static/`) 안의 **모든 파일·폴더**를 드래그해서 업로드
   - `.github/`, `scripts/`, `site/`, `README.md`, `buffett_investment_method_korean.md` 모두
3. 아래 **Commit changes** 버튼 클릭

#### 방법 B: git 명령어 (익숙하면)

```bash
cd buffett-flow-static
git init -b main
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/<your-id>/<repo-name>.git
git push -u origin main
```

---

### 3단계 — KRX 계정 정보를 GitHub Secrets 에 등록

KRX 로그인 정보가 코드에 노출되면 안 되므로 GitHub Secrets 에 안전하게 저장합니다.

1. 저장소 페이지 상단의 **Settings** 클릭
2. 좌측 메뉴 **Secrets and variables** → **Actions** 클릭
3. **New repository secret** 버튼 → 두 개를 차례로 등록:

| Name | Value |
|---|---|
| `KRX_ID` | KRX Data Marketplace 에서 가입한 **아이디** |
| `KRX_PW` | KRX Data Marketplace 에서 가입한 **비밀번호** |

> 🔒 **Secrets 는 누구도(본인 포함) 다시 볼 수 없습니다.** 잊어버리면 새로 등록해야 합니다. GitHub Actions 워크플로 안에서만 환경변수로 주입됩니다.

---

### 4단계 — GitHub Pages 활성화

1. 저장소의 **Settings** → 좌측 **Pages** 클릭
2. **Source** 항목에서 **"GitHub Actions"** 선택 (Deploy from a branch 가 아닙니다)
3. 저장. 끝.

---

### 5단계 — 첫 실행 (수동 트리거)

스케줄을 기다리지 말고 즉시 한 번 돌려봅니다.

1. 저장소 상단의 **Actions** 탭 클릭
2. 좌측 목록에서 **📊 Update Buffett Flow Data** 클릭
3. 우측의 **Run workflow** 버튼 → **Run workflow** (브랜치 main 선택)
4. 약 5~10분 대기. 초록색 ✓ 가 뜨면 성공.

### 6단계 — 사이트 접속

URL 형식: **`https://<your-id>.github.io/<repo-name>/`**

예: GitHub ID 가 `hong-gildong`, 저장소 이름이 `buffett-flow` 라면:
**`https://hong-gildong.github.io/buffett-flow/`**

📱 이 URL 을 모바일 홈 화면에 추가하면 앱처럼 사용 가능합니다.

---

## 🗓️ 자동 갱신 스케줄

`.github/workflows/update.yml` 에서 cron 으로 정해져 있습니다.

```yaml
schedule:
  - cron: '0 10 * * 1-5'  # UTC 10:00 = KST 19:00, 월~금
```

- **KST 19:00** = KRX 가 연기금까지 모든 투자자 매매내역을 반영한 직후
- 토/일은 휴장이라 스킵
- 수동 실행도 언제든 가능 (Actions 탭에서)

시간을 바꾸고 싶으면 cron 표현식 수정:
- `'0 11 * * 1-5'` → KST 20시
- `'30 9 * * 1-5'` → KST 18:30

---

## 🗂️ 폴더 구조

```
buffett-flow-static/
├── .github/workflows/
│   └── update.yml                # 매일 KST 19시 자동 실행 워크플로
├── scripts/
│   ├── fetch_data.py             # pykrx → JSON 변환
│   ├── buffett_score.py          # 점수 계산 로직
│   └── requirements.txt
├── site/                         # ← GitHub Pages 가 서빙하는 폴더
│   ├── index.html                # 단일 페이지
│   ├── css/style.css             # 반응형 스타일
│   ├── js/app.js                 # 탭 전환 / 모달
│   └── data/                     # Actions 가 매일 자동 갱신
│       ├── manifest.json
│       ├── flow_KOSPI_1d.json
│       ├── flow_KOSPI_5d.json
│       ├── flow_KOSPI_20d.json
│       ├── flow_KOSDAQ_1d.json
│       ├── flow_KOSDAQ_5d.json
│       ├── flow_KOSDAQ_20d.json
│       └── fundamentals.json
├── buffett_investment_method_korean.md
└── README.md
```

---

## 📱 사용 화면

```
┌─────────────────────────────────────┐
│ 📊 버핏식 수급 뷰어                  │
│ 기준일: 2026-05-14 | 갱신: 19:02 KST│
├─────────────────────────────────────┤
│ [코스피] [코스닥]                    │  ← 시장 탭
│ [1일] [5일] [20일]                   │  ← 기간 탭
│ [기관] [연기금] [외국인] [사모]      │  ← 투자자 탭
│ [📈순매수] [🟢매수] [🔴매도]         │  ← 매매종류 탭
├─────────────────────────────────────┤
│ 순위 | 종목     | 매수 | 매도 | 순매수 | 점수│
│ 1   | 삼성전자  | 1234 | 800  | +434  | 73 │
│ 2   | SK하이닉스| 987  | 100  | +887  | 65 │
│ ...                                  │
└─────────────────────────────────────┘
   ↓ 행 탭하면
┌─────────────────────────────────────┐
│ 삼성전자                        ×    │
│ PER 12.5 | PBR 1.3 | 배당 2.8%      │
│                                     │
│ 🎯 73.3 / 100  [조건부 검토]         │
│                                     │
│ ✅ 자동 | ROE 추정 | 10/15           │
│ ✅ 자동 | PER 평가 | 4/5             │
│ 📝 수동 | 사업 이해도 | 0/10         │
│ ...                                  │
│                                     │
│ 🔍 DART 에서 삼성전자 공시 보기 →    │
└─────────────────────────────────────┘
```

---

## ⚠️ 알아두실 점

### 비용
- GitHub Public 저장소: **무료**
- GitHub Actions: 월 2,000분 무료 (이 워크플로는 1회 약 5분 → 월 약 100분 사용)
- GitHub Pages: **무료**
- 즉, **이 프로젝트는 전액 무료**로 운영됩니다.

### 보안
- KRX 자격증명은 **GitHub Secrets** 에만 저장되며 워크플로 로그에도 노출되지 않습니다.
- 저장소를 Public 으로 만들어도 Secrets 는 안전합니다.
- 단, 저장소를 Private 으로 만들면 Actions 분 수 한도가 더 빡빡합니다 (Private 은 무료 500분/월).

### 한계
- **인터랙티브 조회 불가**: 임의의 날짜나 종목은 조회 불가능. 매일 한 번 자동 생성된 스냅샷만 봅니다.
- **시간 지연**: KST 19시 직후가 가장 신선. 새벽이나 다음 날 오전에 봐도 그 데이터 그대로.
- **장중 데이터 없음**: KRX 데이터 자체가 장중에는 잠정치이므로, 장 마감 후 19시에 한 번 받습니다.
- **수동 항목**: 현금흐름, 부채, 해자 등 6개 항목 (55점)은 자동 채점이 불가능합니다. DART 사업보고서 직접 확인이 필수입니다.

### 면책
본 사이트는 투자 판단 보조 자료이며 매매 추천이 아닙니다. 자동 채점은 PER/PBR/배당/시총 등 제한된 항목만 반영하며, 실제 투자 전 **DART 전자공시(dart.fss.or.kr)** 사업보고서 직접 검토가 필요합니다. 투자 손실에 대한 책임은 사용자 본인에게 있습니다.

---

## 🔧 자주 발생하는 문제

| 증상 | 원인 / 해결 |
|---|---|
| Actions 가 빨간색 ✗ 로 실패 | Secrets 의 KRX_ID / KRX_PW 가 잘못 등록됨 → KRX 사이트에서 본인 ID/PW 로 로그인 가능한지 먼저 확인 |
| 빨간색 ✗ 인데 "Permission to push" 에러 | Settings → Actions → General → Workflow permissions → **Read and write permissions** 선택 |
| Pages URL 접속 시 404 | Settings → Pages 에서 Source 가 **GitHub Actions** 로 되어 있는지 재확인 |
| 사이트 열리지만 "데이터 없음" | 첫 Actions 실행이 아직 안 됨 → Actions 탭에서 수동 Run 한 번 실행 |
| 1일(당일) 데이터만 빈 표 | KRX 가 아직 당일 데이터 미반영 → 5일/20일 탭 사용 |
| 연기금/사모 표만 빔 | 그날 해당 투자자 매매가 없거나 적었음. 5일/20일 탭으로 확인 |
| Actions 가 매일 안 돌아감 | 60일간 저장소에 활동이 없으면 GitHub 가 schedule cron 을 자동 비활성화함 → 수동 Run 한 번이면 다시 활성화 |

---

## 📚 참고

- 점수 기준 문서: [buffett_investment_method_korean.md](./buffett_investment_method_korean.md)
- pykrx: https://github.com/sharebook-kr/pykrx
- KRX Data Marketplace: https://data.krx.co.kr
- DART 전자공시: https://dart.fss.or.kr

---

## 📝 라이선스

본 코드는 개인용 비상업적 사용을 전제로 합니다. KRX 데이터의 저작권은 한국거래소에 있습니다.
