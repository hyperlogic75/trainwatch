# 자리알림 서버 (TrainWatch API)

KTX·SRT 빈자리 감시 + 푸시 알림 백엔드

---

## 기술 스택

- **Fastify** — Node.js 웹 프레임워크
- **Prisma** — PostgreSQL ORM
- **Playwright** — 코레일/SRT 스크래핑
- **Firebase Admin** — FCM 푸시 알림
- **Railway** — 배포 플랫폼

---

## Railway 배포 방법 (처음 배포 시)

### 1. Railway CLI 설치

```bash
npm install -g @railway/cli
railway login
```

### 2. 프로젝트 초기화

```bash
cd trainwatch-server
railway init          # 새 프로젝트 생성
railway link          # 기존 프로젝트 연결
```

### 3. PostgreSQL 플러그인 추가

Railway 대시보드 → 프로젝트 → + New → Database → PostgreSQL 추가
→ `DATABASE_URL` 환경변수 자동 주입됨

### 4. 환경변수 설정

```bash
# CLI로 한 번에 설정
railway variables set \
  NODE_ENV=production \
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}' \
  GOOGLE_CLIENT_ID=your-client-id \
  GOOGLE_CLIENT_SECRET=your-client-secret
```

또는 Railway 대시보드 → Variables에서 직접 입력

### 5. 배포

```bash
railway up
```

배포 완료 후 도메인이 자동 발급됩니다:
`https://trainwatch-api-production-xxxx.up.railway.app`

### 6. 앱에 API URL 연결

`TrainWatch/.env` 파일:
```
EXPO_PUBLIC_API_URL=https://trainwatch-api-production-xxxx.up.railway.app
```

### 7. 첫 DB 마이그레이션 확인

```bash
railway run npx prisma migrate status
```

---

## 로컬 개발

```bash
# 의존성 설치
npm install
npx playwright install chromium

# .env 파일 생성
cp .env.example .env
# .env 파일에서 DATABASE_URL, JWT_SECRET 등 설정

# DB 마이그레이션
npx prisma migrate dev

# 개발 서버 시작
npm run dev
```

---

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| POST | /auth/register | 이메일 회원가입 |
| POST | /auth/login | 이메일 로그인 |
| POST | /auth/apple | Apple 로그인 |
| POST | /auth/google | Google 로그인 |
| POST | /auth/fcm-token | FCM 토큰 등록 |
| GET | /watches | 감시 목록 |
| POST | /watches | 감시 조건 등록 |
| DELETE | /watches/:id | 감시 삭제 |
| POST | /watches/:id/pause | 감시 일시정지 |
| POST | /watches/:id/resume | 감시 재개 |
| POST | /watches/:id/check | 즉시 확인 |
| GET | /health | 서버 상태 확인 |

---

## 환경변수 목록

| 변수 | 필수 | 설명 |
|------|------|------|
| DATABASE_URL | ✅ | PostgreSQL 연결 문자열 (Railway 자동 주입) |
| JWT_SECRET | ✅ | JWT 서명 키 (32바이트 이상 랜덤) |
| FIREBASE_SERVICE_ACCOUNT_JSON | ✅ | Firebase 서비스 계정 JSON (한 줄) |
| GOOGLE_CLIENT_ID | ✅ | Google OAuth 클라이언트 ID |
| GOOGLE_CLIENT_SECRET | ✅ | Google OAuth 클라이언트 시크릿 |
| PORT | - | 포트 (기본값: 3000) |
| NODE_ENV | - | 환경 (기본값: production) |
| ALLOWED_ORIGINS | - | CORS 허용 도메인 |

---

## 모니터링

```bash
# 실시간 로그 확인
railway logs --tail

# 환경변수 확인
railway variables

# 서버 상태 확인
curl https://your-domain.up.railway.app/health
```
