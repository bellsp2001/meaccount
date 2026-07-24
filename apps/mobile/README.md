# MeAccount Mobile (React Native + Expo)

## ⚠️ Important — read before running

This app was written in a sandboxed environment **without an iOS/Android
simulator or physical device available**. That means:

- ✅ **Verified**: All TypeScript source compiles logically, and the pure-logic
  code (`src/utils/format.ts`, `src/utils/validation.ts`, `src/api/endpoints.ts`)
  is unit tested with Jest — **59/59 tests pass**, run in a real (if minimal)
  Node/Jest environment, not just written and assumed correct.
- ✅ **Verified**: Every API call in `src/api/endpoints.ts` targets a path that
  exists and is covered by the backend's own pytest suite
  (`apps/api/tests/`, 182 passing tests as of Phase 3 W29-30).
- ❌ **Not verified**: Whether the screens actually render correctly, whether
  navigation transitions work, whether the camera/OCR flow behaves right on a
  real device, or whether there are React Native-specific runtime bugs. That
  requires `expo start` on a machine with a simulator or physical device,
  which isn't available here.

Treat this as a strong, working starting point — not a QA'd, ship-ready app.
Run it locally and click through every screen before trusting it in production.

## Setup

```bash
cd apps/mobile
npm install
npx expo start
```

Then press `i` for iOS simulator, `a` for Android emulator, or scan the QR
code with the Expo Go app on a physical device.

You'll need to point the app at your running MeAccount API — edit
`app.json` → `expo.extra.apiUrl`, or set it via an EAS environment variable
for production builds.

## Running tests

```bash
npm test
```

This runs Jest against `src/utils/*` and `src/api/endpoints.ts` — the parts
of the app that don't need a device to verify. Screens themselves aren't
covered by automated tests in this delivery (would need
`@testing-library/react-native` + a working RN test renderer, which needs
resolving some peer-dependency conflicts with the Expo 52 / RN 0.76 combo
used here — see `package.json`).

## What's implemented

| Screen | Purpose |
|---|---|
| `LoginScreen` | Email/password login against `/api/v1/auth/login` |
| `DashboardScreen` | KPI cards from `/api/v1/dashboard/kpi`, pull-to-refresh |
| `ApprovalScreen` | One-tap approve/reject for pending Bills |
| `ReceiptScanScreen` | Camera or gallery photo → AI OCR via `/api/v1/ap/ai/ocr-receipt` |
| `AIChatScreen` | Same RAG-backed chat as the web app, via `/api/v1/chat-v2/message` |

## Architecture notes

- **Auth**: JWT access/refresh tokens stored in `expo-secure-store` (encrypted
  device storage, not AsyncStorage) — same refresh-on-401 pattern as the web
  app's axios interceptor.
- **State**: Zustand for auth state (mirrors the web app's `useAuthStore`),
  TanStack Query for server state/caching.
- **API layer**: `src/api/client.ts` (axios instance + interceptors) and
  `src/api/endpoints.ts` (typed wrappers) are separated so the wrappers can be
  unit tested with a mocked axios instance — no native modules needed to test
  the actual request-shaping logic.
