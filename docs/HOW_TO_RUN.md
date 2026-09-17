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

### 5b. Dùng model AI chạy local / self-host (không cần API cloud)

Kumanga không bundle model nào, nhưng chuẩn **OpenAI-compatible** và **Custom API** trong AI Settings gọi được bất kỳ server local nào expose đúng chuẩn REST đó — không cần code thêm gì. Chỉ cần 2 bước:

1. Thêm vào `.env.local`: `ALLOW_PRIVATE_NETWORKS=1` (chỉ dùng khi chạy `npm run dev` local, **không** bật khi deploy production — server hosted không với tới `localhost` của bạn nên bật ở đó vô nghĩa và mở lỗ SSRF).
2. Trong AI Settings, cấu hình provider trỏ vào server local đang chạy trên máy bạn.

**Manga Agent (LLM văn bản)** — dùng chuẩn **OpenAI-compatible**, đã chạy được ngay:

| Server local | Base URL | Ghi chú |
|---|---|---|
| Ollama | `http://localhost:11434/v1` | Bật chế độ OpenAI-compat có sẵn của Ollama |
| LM Studio | `http://localhost:1234/v1` | Bật "Local Server" trong LM Studio trước |

**Sinh ảnh (Image generation)**:

| Server local | Cách cấu hình |
|---|---|
| Automatic1111 (webui) | Custom API, method `POST`, endpoint `http://localhost:7860/sdapi/v1/txt2img`, execution **sync**, response type `base64`, response path `images[0]` |
| ComfyUI | Chuẩn riêng **"ComfyUI (local)"** trong danh sách provider — chỉ cần Base URL (mặc định `http://127.0.0.1:8188`) và Model = **tên file checkpoint** đúng như ComfyUI hiển thị (ví dụ `sd_xl_base_1.0.safetensors`). Không cần API key. |

ComfyUI dùng một adapter riêng (không qua Custom API) vì API của nó không phải REST đơn giản: `/history/{prompt_id}` trả kết quả dưới một key **động** chính là `prompt_id` vừa submit, và workflow graph gửi lên quá lớn so với giới hạn cookie — adapter tự dựng workflow ở phía server. Mở mục "Advanced — ComfyUI settings" trong AI Settings để chỉnh steps/CFG/sampler/scheduler, có nút "Fetch LoRAs"/"Fetch ControlNet models" để chọn từ danh sách ComfyUI đang có (không cần gõ tay), và thêm tối đa 4 LoRA (tên file + độ mạnh). Nếu tạo nhân vật/pose kèm ảnh tham chiếu, ComfyUI cũng tự chuyển sang chế độ img2img (giữ nét đặc trưng của ảnh tham chiếu, vẫn cho phép đổi pose/biểu cảm). Sửa ảnh cục bộ (vẽ mask rồi yêu cầu AI sửa vùng đó) cũng dùng được với ComfyUI, tận dụng đúng khả năng inpainting theo mask thật của nó — nếu lúc sửa có kèm ảnh tham chiếu nhân vật (tự động khi sửa ảnh của một nhân vật đã có ảnh gốc), ComfyUI dùng **IPAdapter** để giữ đúng đặc điểm nhân vật đó, không cần cấu hình gì thêm (chỉ cần cài node pack `ComfyUI_IPAdapter_plus` — không có sẵn trong ComfyUI gốc; nếu chưa cài, ComfyUI báo lỗi rõ ràng chứ không sinh sai âm thầm). Có thể chỉnh preset/độ mạnh IPAdapter trong "Advanced — ComfyUI settings". **ControlNet** (giữ đúng tư thế/nét vẽ theo một ảnh điều khiển): cấu hình 1 model ControlNet trong AI Settings, rồi khi tạo ảnh chọn thêm "Control image" — ảnh này bạn phải tự xử lý sẵn (ví dụ ảnh khung xương OpenPose), Kumanga không tự động tách pose/nét từ ảnh thường.

### 5c. Azure OpenAI (Agent) + chạy model ảnh trên Kaggle GPU free (Image Generation)

Kết hợp: chữ (Manga Agent) dùng API trả phí ổn định như Azure OpenAI, còn sinh ảnh dùng GPU free của Kaggle — không cần tự thuê GPU.

**Azure OpenAI cho Manga Agent** — không chọn chuẩn "OpenAI-compatible" (Azure dùng header xác thực khác, `api-key` chứ không phải `Authorization: Bearer`, và cần thêm `?api-version=...` trên URL — đã kiểm tra code, chuẩn OpenAI-compatible không khớp). Chọn **Custom API** thay vào đó:

| Trường | Giá trị |
|---|---|
| Endpoint | Dán nguyên URL Azure, gồm cả `?api-version=...`, ví dụ: `https://<resource>.openai.azure.com/openai/deployments/<deployment>/chat/completions?api-version=2024-08-01-preview` |
| Auth mode | Header |
| Tên header | `api-key` |
| Giá trị header | API key Azure của bạn |
| Request template | Giữ mặc định (dạng Chat Completions, dùng `{{messages}}`) |
| Response text path | Giữ mặc định `choices[0].message.content` |

Bấm **Test Connection** trước khi Save.

**Chạy ComfyUI trên Kaggle (GPU free), xuất ra URL public để Kumanga gọi:**

1. Vào kaggle.com → Code → New Notebook → mục Settings bên phải → Accelerator → chọn **GPU T4 x2** (hoặc P100). Dùng chế độ **Interactive session** (không dùng "Save & Run All / Commit" — chế độ đó chạy xong tự tắt máy, không giữ server sống).
2. Cài và tải model, dán vào 1 cell:
   ```python
   !git clone https://github.com/comfyanonymous/ComfyUI.git
   !pip install -r ComfyUI/requirements.txt -q

   # Đổi URL theo checkpoint bạn muốn dùng
   !wget -q -O ComfyUI/models/checkpoints/sd_xl_base_1.0.safetensors \
     "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"
   ```
3. Chạy server ComfyUI ở chế độ nền:
   ```python
   import subprocess
   subprocess.Popen(["python", "ComfyUI/main.py", "--listen", "0.0.0.0", "--port", "8188"])
   ```
4. Mở tunnel để có URL public (dùng `cloudflared`, không cần tạo tài khoản):
   ```python
   !wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O cloudflared
   !chmod +x cloudflared
   import subprocess, time
   tunnel = subprocess.Popen(["./cloudflared", "tunnel", "--url", "http://localhost:8188"],
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
   time.sleep(6)
   for _ in range(20):
       line = tunnel.stdout.readline()
       if "trycloudflare.com" in line:
           print(line)
           break
   ```
   Copy URL dạng `https://xxxx-xxxx.trycloudflare.com` in ra ở bước này.
5. Trong Kumanga: AI Settings → Image Generation → chọn **ComfyUI (local)** → Base URL = URL cloudflared vừa lấy → Model = tên file checkpoint (ví dụ `sd_xl_base_1.0.safetensors`) → **không cần** bật `ALLOW_PRIVATE_NETWORKS=1` (URL này là public thật) → Test Connection → Save.

**Lưu ý quan trọng:**
- Kaggle interactive session tự tắt sau một khoảng không hoạt động, và có giới hạn giờ GPU/tuần theo tài khoản — mỗi lần notebook restart, URL cloudflared **đổi mới hoàn toàn**, phải vào AI Settings dán lại Base URL.
- Giữ tab notebook đang mở/hoạt động để Kaggle không tự ngắt session giữa lúc dùng.
- Phù hợp để test/dùng cá nhân; Kaggle không cam kết SLA cho server chạy liên tục — không nên dùng làm hạ tầng production phục vụ nhiều người dùng thật cùng lúc.
- Các bước/lệnh trên dựa theo giao diện Kaggle và ComfyUI tại thời điểm viết — có thể cần chỉnh nếu Kaggle đổi UI hoặc ComfyUI đổi cấu trúc thư mục.

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
- **Muốn dùng model AI chạy trên máy (Ollama/LM Studio/Automatic1111)** — xem mục [5b](#5b-dùng-model-ai-chạy-local--self-host-không-cần-api-cloud) ở trên.
- **Muốn dùng Azure OpenAI hoặc chạy model ảnh trên GPU free của Kaggle** — xem mục [5c](#5c-azure-openai-agent--chạy-model-ảnh-trên-kaggle-gpu-free-image-generation) ở trên.
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

### 5b. Using a local/self-hosted AI model (no cloud API needed)

Kumanga bundles no model, but the **OpenAI-compatible** and **Custom API** provider types in AI Settings can call any local server that speaks the matching REST shape — no new code required. Two steps:

1. Add `ALLOW_PRIVATE_NETWORKS=1` to `.env.local` (local `npm run dev` only — **never** in production; a hosted deployment can't reach your `localhost` anyway, so enabling it there only opens an SSRF hole for no benefit).
2. In AI Settings, point a provider at the local server running on your machine.

**Manga Agent (text LLM)** — use **OpenAI-compatible**, works today:

| Local server | Base URL | Note |
|---|---|---|
| Ollama | `http://localhost:11434/v1` | Enable Ollama's built-in OpenAI-compatible mode |
| LM Studio | `http://localhost:1234/v1` | Start LM Studio's "Local Server" first |

**Image generation**:

| Local server | Configuration |
|---|---|
| Automatic1111 (webui) | Custom API, method `POST`, endpoint `http://localhost:7860/sdapi/v1/txt2img`, execution **sync**, response type `base64`, response path `images[0]` |
| ComfyUI | Its own **"ComfyUI (local)"** entry in the provider list — just set Base URL (defaults to `http://127.0.0.1:8188`) and Model to the **checkpoint filename** exactly as ComfyUI shows it (e.g. `sd_xl_base_1.0.safetensors`). No API key needed. |

ComfyUI gets a dedicated adapter rather than a Custom API mapping because its protocol isn't plain REST: `/history/{prompt_id}` nests its result under a **dynamic** key — the `prompt_id` that was just submitted — and a full workflow graph is too large for the cookie-based config budget. The adapter builds the workflow server-side. Open "Advanced — ComfyUI settings" in AI Settings to tune steps/CFG/sampler/scheduler, use the "Fetch LoRAs"/"Fetch ControlNet models" buttons to pick from what ComfyUI actually has installed (no manual typing needed), and add up to 4 LoRAs (filename + strength). Generating a character/pose with a reference image also automatically switches to img2img (keeps the reference's identity while still allowing pose/expression changes). Local editing (paint a mask, ask the AI to redraw only that region) works with ComfyUI too, using its real mask-aware inpainting rather than a whole-image redo — if that edit also carries a character's identity reference (automatic when editing an asset belonging to a character that already has one), ComfyUI uses **IPAdapter** to keep that identity, no extra setup beyond installing the `ComfyUI_IPAdapter_plus` node pack (not part of a vanilla install — ComfyUI reports a clear error if it's missing, never a silent wrong result). Preset/weight are tunable in "Advanced — ComfyUI settings". **ControlNet** (matching a specific pose/line-art exactly): configure one ControlNet model in AI Settings, then attach a "Control image" when generating — you supply that image already pre-processed (e.g. an OpenPose skeleton render); Kumanga never runs pose/edge extraction itself.

### 5c. Azure OpenAI (Agent) + running image models on Kaggle's free GPU (Image Generation)

A common combo: use a paid, stable API like Azure OpenAI for text (the Manga Agent), while image generation runs on Kaggle's free GPU quota instead of renting your own.

**Azure OpenAI for the Manga Agent** — don't pick the "OpenAI-compatible" standard (Azure uses a different auth header, `api-key` instead of `Authorization: Bearer`, and needs a `?api-version=...` query param on the URL — checked the code, the OpenAI-compatible adapter doesn't match this). Use **Custom API** instead:

| Field | Value |
|---|---|
| Endpoint | Paste your full Azure URL, including `?api-version=...`, e.g. `https://<resource>.openai.azure.com/openai/deployments/<deployment>/chat/completions?api-version=2024-08-01-preview` |
| Auth mode | Header |
| Header name | `api-key` |
| Header value | Your Azure API key |
| Request template | Keep the default (Chat Completions shape, `{{messages}}`) |
| Response text path | Keep the default `choices[0].message.content` |

Click **Test Connection** before Save.

**Running ComfyUI on Kaggle's free GPU, exposed as a public URL Kumanga can call:**

1. Go to kaggle.com → Code → New Notebook → Settings panel on the right → Accelerator → pick **GPU T4 x2** (or P100). Use **Interactive session** mode, not "Save & Run All / Commit" — that mode shuts the machine down once it finishes, it won't keep a server alive.
2. Install ComfyUI and download a model, in one cell:
   ```python
   !git clone https://github.com/comfyanonymous/ComfyUI.git
   !pip install -r ComfyUI/requirements.txt -q

   # Swap this URL for whichever checkpoint you want
   !wget -q -O ComfyUI/models/checkpoints/sd_xl_base_1.0.safetensors \
     "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"
   ```
3. Start the ComfyUI server in the background:
   ```python
   import subprocess
   subprocess.Popen(["python", "ComfyUI/main.py", "--listen", "0.0.0.0", "--port", "8188"])
   ```
4. Open a tunnel to get a public URL (using `cloudflared`, no account needed):
   ```python
   !wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O cloudflared
   !chmod +x cloudflared
   import subprocess, time
   tunnel = subprocess.Popen(["./cloudflared", "tunnel", "--url", "http://localhost:8188"],
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
   time.sleep(6)
   for _ in range(20):
       line = tunnel.stdout.readline()
       if "trycloudflare.com" in line:
           print(line)
           break
   ```
   Copy the printed `https://xxxx-xxxx.trycloudflare.com` URL.
5. In Kumanga: AI Settings → Image Generation → pick **ComfyUI (local)** → Base URL = the cloudflared URL you just got → Model = the checkpoint filename (e.g. `sd_xl_base_1.0.safetensors`) → **no need** to enable `ALLOW_PRIVATE_NETWORKS=1` (this is a real public URL) → Test Connection → Save.

**Important caveats:**
- A Kaggle interactive session shuts down after a period of inactivity, and GPU hours are capped per week per account — every time the notebook restarts, the cloudflared URL **changes completely**, so you'll need to paste the new Base URL into AI Settings again.
- Keep the notebook tab open/active so Kaggle doesn't end the session mid-use.
- Fine for testing/personal use; Kaggle offers no SLA for running a server continuously — don't rely on this as production infrastructure serving multiple real users at once.
- The exact steps/commands above reflect Kaggle's and ComfyUI's interfaces at the time of writing — you may need to adjust them if either changes.

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
- **Want to use a local model (Ollama/LM Studio/Automatic1111)** — see [section 5b](#5b-using-a-localself-hosted-ai-model-no-cloud-api-needed) above.
- **Want to use Azure OpenAI, or run image models on Kaggle's free GPU** — see [section 5c](#5c-azure-openai-agent--running-image-models-on-kaggles-free-gpu-image-generation) above.
- **Want to deploy to Vercel** — see [`manga-studio/docs/DEPLOYMENT.md`](../manga-studio/docs/DEPLOYMENT.md) for the full walkthrough.

### 8. Related documentation

- [`../CLAUDE.md`](../CLAUDE.md) / [`../AGENTS.md`](../AGENTS.md) — guidance for AI coding agents working in this repo.
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — overall architecture diagram.
- [`RELEASE_FREEZE_V0.1.md`](RELEASE_FREEZE_V0.1.md) — current v0.1 baseline status.
- [`../manga-studio/docs/AI_PROVIDER_ARCHITECTURE.md`](../manga-studio/docs/AI_PROVIDER_ARCHITECTURE.md) — provider abstraction details.
