# How to Run / Hướng Dẫn Chạy Dự Án

*[English](#english) below the Vietnamese section. / Bản tiếng Anh nằm sau bản tiếng Việt.*

---

## Tiếng Việt

### 1. Yêu cầu hệ thống

- **Node.js 18.18 trở lên** (khuyến nghị bản LTS 20+ vì dự án dùng Next.js 15).
- **npm** (đi kèm Node.js) — dự án dùng npm workspaces, không cần cài thêm gì khác.
- Không cần GPU, không cần cài model AI cục bộ — phần sinh ảnh/AI dùng API bên ngoài do bạn tự cấu hình (BYOK).

### 2. Cài đặt

Chạy các lệnh sau từ **thư mục gốc** của repo (`mangaharness/`), không phải từ `manga-studio/`:

```bash
git clone https://github.com/QuangTQV/Manga-Creator.git
cd Manga-Creator
npm install
```

Lệnh `npm install` ở gốc sẽ tự cài luôn phần phụ thuộc của `manga-studio/` nhờ cơ chế npm workspaces.

### 3. Cấu hình biến môi trường (tuỳ chọn)

Studio chạy được **ngay cả khi không cấu hình gì** — bạn có thể mở giao diện, soạn trang, quản lý nhân vật mà chưa cần AI. Chỉ khi muốn dùng tính năng sinh ảnh/Manga Agent mới cần bước này.

```bash
cp .env.example .env.local
```

Mở `.env.local` và điền nếu cần:

| Biến | Bắt buộc khi nào | Ý nghĩa |
|---|---|---|
| `APP_ENCRYPTION_KEY` | Khi deploy production, hoặc muốn key BYOK bạn nhập trong app được mã hoá ổn định | Mã hoá thông tin API key người dùng nhập trong app (AES-256-GCM). **Không phải** API key AI. Tạo bằng: `openssl rand -base64 32` |
| `BLOB_READ_WRITE_TOKEN` | Khi deploy lên Vercel | Lưu trữ ảnh đã sinh/tải lên. Chạy local không có token thì ảnh lưu tạm vào `./.data` |
| `GEMINI_API_KEY`, `AGENT_API_KEY`, ... | Tuỳ chọn | Cấu hình provider AI mặc định ở cấp server. **Bình thường không cần** — bạn tự nhập API key riêng ngay trong giao diện app (mục *AI Settings*), key đó luôn được ưu tiên hơn |
| `ALLOW_PRIVATE_NETWORKS=1` | Chỉ khi muốn gọi model AI chạy local (Ollama, LM Studio) trong lúc phát triển | **Không bật khi deploy production** |

### 4. Chạy dự án ở chế độ phát triển

```bash
npm run dev
```

Mở trình duyệt tại: **http://localhost:3000**

### 5. Cấu hình AI provider ngay trong app (BYOK)

1. Mở app, vào **AI Settings**.
2. Chọn chuẩn API (Gemini / OpenAI-compatible / Anthropic-compatible / Custom API).
3. Nhập Base URL + API key + tên model của bạn.
4. Bấm **Test Connection** để kiểm tra, rồi **Save**.

API key được mã hoá và lưu trong cookie HttpOnly phía server — không lưu vào dữ liệu project, không đọc được từ JavaScript phía trình duyệt.

### 6. Các lệnh khác

Chạy từ thư mục gốc (đều tự proxy vào `manga-studio/`):

| Lệnh | Chức năng |
|---|---|
| `npm run build` | Build bản production |
| `npm run start` | Chạy bản đã build |
| `npm test` | Chạy toàn bộ test (domain, geometry, bảo mật, agent) |
| `npm run typecheck` | Kiểm tra kiểu TypeScript (`tsc --noEmit`) |
| `npm run lint` | Kiểm tra lint (eslint) |

Trước khi coi một thay đổi là "xong", nên chạy đủ cả 4 lệnh: `npm test && npm run typecheck && npm run lint && npm run build`.

### 7. Xử lý sự cố thường gặp

- **Cổng 3000 đã bị chiếm** — kiểm tra xem có tiến trình `next dev` nào đang chạy sẵn không, hoặc đổi cổng: `PORT=3001 npm run dev`.
- **Không sinh được ảnh** — vào AI Settings, bấm Test Connection để xem lỗi cụ thể (sai key, sai base URL, model không tồn tại...).
- **Muốn dùng model AI chạy trên máy (Ollama/LM Studio)** — thêm `ALLOW_PRIVATE_NETWORKS=1` vào `.env.local`, chỉ dùng khi phát triển local, không dùng khi deploy thật.
- **Muốn deploy lên Vercel** — xem hướng dẫn chi tiết tại [`manga-studio/docs/DEPLOYMENT.md`](../manga-studio/docs/DEPLOYMENT.md).

### 8. Tài liệu liên quan

- [`../CLAUDE.md`](../CLAUDE.md) / [`../AGENTS.md`](../AGENTS.md) — hướng dẫn cho AI coding agent làm việc trong repo này.
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — sơ đồ kiến trúc tổng thể.
- [`RELEASE_FREEZE_V0.1.md`](RELEASE_FREEZE_V0.1.md) — trạng thái baseline v0.1 hiện tại.
- [`../manga-studio/docs/AI_PROVIDER_ARCHITECTURE.md`](../manga-studio/docs/AI_PROVIDER_ARCHITECTURE.md) — chi tiết cơ chế provider AI.

---

## English

### 1. Requirements

- **Node.js 18.18 or later** (20+ LTS recommended — the app uses Next.js 15).
- **npm** (ships with Node.js) — the repo uses npm workspaces, no extra tooling needed.
- No GPU and no local AI model install required — image/AI generation goes through external APIs you configure yourself (BYOK).

### 2. Install

Run these from the **repository root** (`mangaharness/`), not from `manga-studio/`:

```bash
git clone https://github.com/QuangTQV/Manga-Creator.git
cd Manga-Creator
npm install
```

The root `npm install` also installs `manga-studio/`'s dependencies via npm workspaces.

### 3. Environment variables (optional)

The studio runs **with zero configuration** — you can open the UI, compose pages, and manage characters before touching AI at all. This step is only needed for image generation / the Manga Agent.

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in as needed:

| Variable | Needed when | Purpose |
|---|---|---|
| `APP_ENCRYPTION_KEY` | Deploying to production, or you want the BYOK keys you enter in-app encrypted with a stable key | Encrypts user-entered provider credentials (AES-256-GCM). **Not** an AI API key itself. Generate with: `openssl rand -base64 32` |
| `BLOB_READ_WRITE_TOKEN` | Deploying to Vercel | Persistent storage for generated/uploaded images. Without it locally, images fall back to `./.data` |
| `GEMINI_API_KEY`, `AGENT_API_KEY`, ... | Optional | Server-side default AI providers. **Usually not needed** — you normally connect your own key in-app (*AI Settings*), which always takes priority |
| `ALLOW_PRIVATE_NETWORKS=1` | Only if you want to call a local model server (Ollama, LM Studio) during development | **Never enable this in production** |

### 4. Run in development mode

```bash
npm run dev
```

Open your browser at: **http://localhost:3000**

### 5. Configure an AI provider in-app (BYOK)

1. Open the app, go to **AI Settings**.
2. Pick an API standard (Gemini / OpenAI-compatible / Anthropic-compatible / Custom API).
3. Enter your base URL + API key + model name.
4. Click **Test Connection**, then **Save**.

Credentials are encrypted and stored in an HttpOnly server-side cookie — never written into project data, never readable from browser JavaScript.

### 6. Other commands

Run from the repository root (each proxies into `manga-studio/`):

| Command | What it does |
|---|---|
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm test` | Full test suite (domain, geometry, security, agent) |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |
| `npm run lint` | eslint |

Before treating a change as done, run all four:
`npm test && npm run typecheck && npm run lint && npm run build`.

### 7. Troubleshooting

- **Port 3000 already in use** — check for an existing `next dev` process, or use a different port: `PORT=3001 npm run dev`.
- **Image generation fails** — open AI Settings and click Test Connection to see the exact error (bad key, wrong base URL, unknown model...).
- **Want to use a local model (Ollama/LM Studio)** — add `ALLOW_PRIVATE_NETWORKS=1` to `.env.local`; development only, never in a production deployment.
- **Want to deploy to Vercel** — see [`manga-studio/docs/DEPLOYMENT.md`](../manga-studio/docs/DEPLOYMENT.md) for the full walkthrough.

### 8. Related documentation

- [`../CLAUDE.md`](../CLAUDE.md) / [`../AGENTS.md`](../AGENTS.md) — guidance for AI coding agents working in this repo.
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — overall architecture diagram.
- [`RELEASE_FREEZE_V0.1.md`](RELEASE_FREEZE_V0.1.md) — current v0.1 baseline status.
- [`../manga-studio/docs/AI_PROVIDER_ARCHITECTURE.md`](../manga-studio/docs/AI_PROVIDER_ARCHITECTURE.md) — provider abstraction details.
