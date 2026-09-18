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

ComfyUI dùng một adapter riêng (không qua Custom API) vì API của nó không phải REST đơn giản: `/history/{prompt_id}` trả kết quả dưới một key **động** chính là `prompt_id` vừa submit, và workflow graph gửi lên quá lớn so với giới hạn cookie — adapter tự dựng workflow ở phía server. Mở mục "Advanced — ComfyUI settings" trong AI Settings để chỉnh steps/CFG/sampler/scheduler, có nút "Fetch LoRAs"/"Fetch ControlNet models" để chọn từ danh sách ComfyUI đang có (không cần gõ tay), và thêm tối đa 4 LoRA (tên file + độ mạnh). Nếu tạo nhân vật/pose kèm ảnh tham chiếu, ComfyUI cũng tự chuyển sang chế độ img2img (giữ nét đặc trưng của ảnh tham chiếu, vẫn cho phép đổi pose/biểu cảm). Sửa ảnh cục bộ (vẽ mask rồi yêu cầu AI sửa vùng đó) cũng dùng được với ComfyUI, tận dụng đúng khả năng inpainting theo mask thật của nó — nếu lúc sửa có kèm ảnh tham chiếu nhân vật (tự động khi sửa ảnh của một nhân vật đã có ảnh gốc), ComfyUI dùng **IPAdapter** để giữ đúng đặc điểm nhân vật đó, không cần cấu hình gì thêm (chỉ cần cài node pack `ComfyUI_IPAdapter_plus` — không có sẵn trong ComfyUI gốc; nếu chưa cài, ComfyUI báo lỗi rõ ràng chứ không sinh sai âm thầm). Có thể chỉnh preset/độ mạnh IPAdapter trong "Advanced — ComfyUI settings". **ControlNet** (giữ đúng tư thế/nét vẽ theo một ảnh điều khiển): cấu hình 1 model ControlNet trong AI Settings, rồi khi tạo ảnh chọn thêm "Control image" — ảnh này bạn phải tự xử lý sẵn (ví dụ ảnh khung xương OpenPose), Kumanga không tự động tách pose/nét từ ảnh thường. **Tách nền fallback bằng ComfyUI**: mục AI Settings → Background Removal → "Configure fallback" → chọn **"ComfyUI (local)"** — dùng chính (hoặc một) server ComfyUI, cần cài thêm node pack `ComfyUI-Inspyrenet-Rembg` (không có sẵn trong ComfyUI gốc). Đây là fallback độc lập với ComfyUI dùng cho sinh ảnh — có thể trỏ 2 mục này vào 2 server ComfyUI khác nhau, hoặc cùng 1 server cũng được.

**Chọn checkpoint/LoRA cho ComfyUI — tránh lỗi "Background removal did not complete":**

Khi tạo một nhân vật (asset dạng cắt trong suốt), Kumanga luôn chèn vào prompt yêu cầu "cô lập trên nền trắng tinh, không bối cảnh" rồi **tự tách nền bằng thuật toán cục bộ** (dò vùng màu liền từ viền ảnh vào — không dùng AI để tách nền). Checkpoint SDXL gốc (`sd_xl_base_1.0.safetensors`) thường **không tuân theo tốt** chỉ dẫn này — hay vẽ thêm phố xá/nội thất phía sau nhân vật — khiến bước tách nền không tìm được vùng trắng liền mạch và thất bại với đúng lỗi trên. **Đã kiểm chứng thật trên Kaggle T4**: thêm 1 LoRA line-art bên dưới vào đúng checkpoint gốc này khắc phục được — không cần đổi checkpoint. (Đã thử đổi sang checkpoint anime-tag như Animagine XL 4.0 với hy vọng bám prompt tốt hơn, nhưng thực tế kết hợp với LoRA lại ra ảnh gần trắng trơn/garbage trên bản ComfyUI 0.36.0 — xem bảng checkpoint ở mục 5c dưới. Giữ nguyên checkpoint gốc là lựa chọn ổn định hơn.)

**Cập nhật quan trọng — nếu đổi sang checkpoint khác mà ảnh ra gần như trống/vài đốm đen vô nghĩa (dù đã tắt hết LoRA):** đây thường **không phải lỗi LoRA hay prompt**, mà do checkpoint đó train theo kiểu **v-prediction** (một số bản NoobAI-vpred, Illustrious-family) còn workflow của Kumanga trước đây chỉ hỗ trợ **epsilon-prediction** (kiểu SDXL gốc) — chạy sai kiểu sampling này ra đúng triệu chứng "trống trơn + vài đốm đen". Kumanga hiện đã hỗ trợ chỉnh: AI Settings → Image Generation → "Advanced — ComfyUI settings" → **"Prediction type"** → chọn **"V-prediction"** nếu checkpoint bạn dùng thuộc loại này (kiểm tra model card của checkpoint trên Civitai/Hugging Face để biết chắc — không đoán từ tên). Checkpoint gốc `sd_xl_base_1.0.safetensors` là epsilon nên để mặc định.

| LoRA | Vai trò | Nguồn |
|---|---|---|
| Manga line-art LoRA | Ép nét vẽ về đúng phong cách line art manga đơn sắc (khớp art style "Minimal Line Manga" mặc định của Kumanga) | [`artificialguybr/LineAniRedmond-LinearMangaSDXL-V2`](https://huggingface.co/artificialguybr/LineAniRedmond-LinearMangaSDXL-V2) (Hugging Face, tải trực tiếp không cần tài khoản) — trigger word `LineAniAF, lineart` |
| White background LoRA | Ép nền trắng tinh, giúp bước tách nền của Kumanga thành công | [`White Background`](https://civitai.com/models/119388/white-background) (Civitai) — trigger phrase `with a white background`, độ mạnh khoảng 1.0–1.2 |

Tải vào server đang chạy ComfyUI (ví dụ notebook Kaggle ở mục 5c dưới), đặt vào `ComfyUI/models/loras/`:
```python
# LoRA line-art manga — Hugging Face, wget thẳng không cần đăng nhập
!wget -q -O ComfyUI/models/loras/LineAniRedmondV2-Lineart-LineAniAF.safetensors \
  "https://huggingface.co/artificialguybr/LineAniRedmond-LinearMangaSDXL-V2/resolve/main/LineAniRedmondV2-Lineart-LineAniAF.safetensors"

# LoRA nền trắng — Civitai chặn tải ẩn danh, cần API key cá nhân
# (tạo tại civitai.com → Account Settings → API Keys), dán thay TOKEN dưới đây
!wget -q -O ComfyUI/models/loras/white_1_0.safetensors \
  "https://civitai.com/api/download/models/129692?fileId=94019&token=TOKEN"
```
Trong Kumanga: AI Settings → Image Generation → mở "Advanced — ComfyUI settings" → bấm "+ Add LoRA" → bấm "Fetch LoRAs" để chọn file vừa tải (khỏi gõ tay tên file). **Bắt đầu chỉ với LoRA line-art** ở độ mạnh **~0.5–0.6**, giữ CFG ở mặc định (7) — đã kiểm chứng ra nhân vật thật với tổ hợp này trên checkpoint gốc. Bản Kumanga hiện tại cũng tự thêm các từ khoá chống nền/sàn/bóng đổ/panel vào negative prompt (không cần cấu hình gì), nên LoRA white-background phía trên thường không cần nữa — chỉ thêm nếu vẫn thấy nền chưa sạch, ở độ mạnh thấp (~0.3). Mỗi dòng LoRA có thêm ô **"applies to"** — với LoRA white-background, chọn **"Character/prop cutouts only"** (không phải "All generations"), vì LoRA thiên về nền trắng sẽ phản tác dụng khi bạn sinh ảnh nền/bối cảnh (`assetType: "background"`) — lúc đó LoRA sẽ tự động không được áp dụng, khỏi cần bật/tắt tay mỗi lần đổi loại ảnh. Dùng nút **"Test generation"** ngay trong AI Settings (cạnh "Test Connection") để xem nhanh ảnh thô mà không cần chạy cả Agent.

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
2. Cài ComfyUI và tải checkpoint. Chọn 1 trong 4 model dưới đây tuỳ nhu cầu — cả 4 đều tải trực tiếp từ Hugging Face, không cần tài khoản:

   | Checkpoint | Phù hợp khi | Kích thước |
   |---|---|---|
   | **[`stabilityai/stable-diffusion-xl-base-1.0`](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0)** (khuyến nghị) | Model gốc — đã kiểm chứng thật trên Kaggle T4: kết hợp với 1 LoRA line-art (mục 5b phía trên) ra nhân vật đúng phong cách, ổn định | ~6.9 GB |
   | [`Minthy/RouWei-0.8`](https://huggingface.co/Minthy/RouWei-0.8) (file `rouwei_080_epsilon_fp16.safetensors`) | Train trên nền Illustrious, cộng đồng đánh giá bám prompt tốt hơn Illustrious/NoobAI gốc — dùng file **`epsilon`** (mặc định không cần đổi gì); nếu thử bản `vpred` thay vào, phải đổi "Prediction type" sang V-prediction trong AI Settings (mục 5b phía trên); chưa tự kiểm chứng trên Kaggle T4 như bản gốc | ~6.9 GB |
   | [`cagliostrolab/animagine-xl-4.0`](https://huggingface.co/cagliostrolab/animagine-xl-4.0) | Train riêng cho anime/manga, bám tag tốt — nhưng **đã quan sát thấy** trên ComfyUI 0.36.0 (có hệ Dynamic VRAM/aimdo): kết hợp với LoRA hay ra ảnh gần trắng trơn/garbage, dù riêng checkpoint này không LoRA thì vẫn vẽ được nội dung. Chưa rõ do bản thân checkpoint hay do tương tác với bản ComfyUI cụ thể này — cân nhắc test kỹ trước khi dùng thật | ~6.9 GB |
   | [`OnomaAIResearch/Illustrious-XL-v2.0`](https://huggingface.co/OnomaAIResearch/Illustrious-XL-v2.0) | Muốn dùng chung với hệ sinh thái LoRA anime lớn nhất hiện nay (đa số LoRA/checkpoint mới trên Civitai train trên nền Illustrious) — chưa kiểm chứng thực tế với LoRA line-art ở trên | ~6.9 GB |

   **Lưu ý khi tìm checkpoint "chuyên B&W manga" trên Civitai**: một số model tên có hậu tố "IL" (ví dụ "Manga Vision IL") gợi ý là "Illustrious" nhưng **thực chất train trên kiến trúc hoàn toàn khác** ("Anima" — VAE 16-channel, flow-matching, không phải epsilon-prediction như SDXL). Loại này **không tương thích** với LoRA SDXL đang dùng (LineAniRedmond) và với graph ComfyUI hiện tại của Kumanga (dựng cứng cho SDXL) — kiểm tra đúng dòng "Base Model" trên trang Civitai/Hugging Face của model đó trước khi tải, đừng suy ra kiến trúc từ tên.

   Dán vào 1 cell (dùng bản gốc — đổi URL/tên file sang dòng tương ứng ở bảng trên nếu muốn thử model khác):
   ```python
   !git clone https://github.com/comfyanonymous/ComfyUI.git
   !pip install -r ComfyUI/requirements.txt -q

   !wget -q -O ComfyUI/models/checkpoints/sd_xl_base_1.0.safetensors \
     "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"

   # Model khác — bỏ dấu # ở 2 dòng tương ứng nếu muốn dùng cái đó thay vì bản gốc trên:

   # RouWei 0.8 (bản epsilon, không phải vpred)
   # !wget -q -O ComfyUI/models/checkpoints/rouwei_080_epsilon_fp16.safetensors \
   #   "https://huggingface.co/Minthy/RouWei-0.8/resolve/main/rouwei_080_epsilon_fp16.safetensors"

   # Animagine XL 4.0 (xem cảnh báo LoRA ở bảng trên)
   # !wget -q -O ComfyUI/models/checkpoints/animagine-xl-4.0.safetensors \
   #   "https://huggingface.co/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0.safetensors"

   # Hệ LoRA Illustrious
   # !wget -q -O ComfyUI/models/checkpoints/Illustrious-XL-v2.0.safetensors \
   #   "https://huggingface.co/OnomaAIResearch/Illustrious-XL-v2.0/resolve/main/Illustrious-XL-v2.0.safetensors"
   ```
   Kiểm tra lại đúng tên file (và kích thước — phòng trường hợp tải lỗi/thiếu) bằng 1 cell riêng:
   ```python
   !ls -la ComfyUI/models/checkpoints/
   ```
   Nhớ đổi **Model** trong AI Settings khớp đúng tên file hiện ra ở đó (ví dụ `sd_xl_base_1.0.safetensors`).

   Muốn dùng IPAdapter (giữ đặc điểm nhân vật khi sửa ảnh cục bộ) trên server Kaggle này thì cài thêm, cùng cell hoặc cell riêng:
   ```python
   !git clone https://github.com/cubiq/ComfyUI_IPAdapter_plus.git ComfyUI/custom_nodes/ComfyUI_IPAdapter_plus
   # Cần thêm model IPAdapter + CLIP vision — xem README của repo trên để lấy đúng link tải theo checkpoint bạn dùng
   ```
   Muốn dùng chính ComfyUI này làm **fallback tách nền** (mục 5 dưới) khi bước tách nền tự động của Kumanga fail, cài thêm — **nhớ chạy cả dòng `pip install` thứ 2**, thiếu dòng đó ComfyUI báo `ModuleNotFoundError: No module named 'transparent_background'` và node bị load fail âm thầm (vẫn chạy được, chỉ riêng node tách nền không dùng được):
   ```python
   !git clone https://github.com/john-mnz/ComfyUI-Inspyrenet-Rembg.git ComfyUI/custom_nodes/ComfyUI-Inspyrenet-Rembg
   !pip install -r ComfyUI/custom_nodes/ComfyUI-Inspyrenet-Rembg/requirements.txt -q
   # Model tự tải khi chạy lần đầu, không cần tải tay thêm gì
   ```
   **Nếu ComfyUI đã đang chạy từ trước khi bạn cài node ở trên, phải dừng và chạy lại lệnh khởi động ở bước 3 dưới.** Custom node chỉ được nạp lúc khởi động; cài xong mà không restart, "Test Connection" vẫn báo OK (chỉ kiểm tra server có phản hồi, không kiểm tra node) nhưng lúc tách nền thật sẽ báo lỗi `missing_node_type: Node 'InspyrenetRembg' not found`.
3. Chạy server ComfyUI ở chế độ nền. **Bắt buộc thêm `--fp32-vae`** — VAE gốc của SDXL bị tràn số (NaN) khi chạy fp16 trên GPU đời T4 (bug SDXL đã biết, không riêng gì Kumanga), sinh ra ảnh trắng/xám mờ không có nội dung thay vì lỗi rõ ràng, dễ nhầm là do prompt hay checkpoint sai:
   ```python
   import subprocess
   subprocess.Popen(["python", "ComfyUI/main.py", "--listen", "0.0.0.0", "--port", "8188", "--fp32-vae"])
   ```
   **Tận dụng GPU T4 x2:** một tiến trình ComfyUI thường chỉ dùng một GPU. Nếu Kaggle cấp hai GPU, chạy hai instance độc lập, mỗi instance ghim vào một GPU và dùng một port riêng. **Bắt buộc thêm `--database-url` riêng cho mỗi instance** — cả 2 chạy từ cùng thư mục `ComfyUI/` nên mặc định dùng chung 1 file database, instance chạy sau sẽ báo `Database is locked` (ComfyUI báo đúng cách sửa ngay trong thông báo lỗi, nhưng nếu bỏ qua rất dễ nhầm là 2 tiến trình xung đột nhau):
   ```python
   import os, subprocess

   def start_comfyui(gpu, port):
       env = os.environ.copy()
       env["CUDA_VISIBLE_DEVICES"] = str(gpu)
       return subprocess.Popen([
           "python", "ComfyUI/main.py", "--listen", "0.0.0.0",
           "--port", str(port), "--cuda-device", "0", "--fp32-vae",
           "--database-url", f"sqlite:///comfyui_gpu{gpu}.db",
       ], env=env)

   comfyui_gpu0 = start_comfyui(0, 8188)
   comfyui_gpu1 = start_comfyui(1, 8189)
   ```
   Hai instance này xử lý **hai request đồng thời**, không làm một ảnh đơn lẻ nhanh gấp đôi. Bước 4 đã mở tunnel cho GPU 0; sau khi tải `cloudflared` và cấp quyền thực thi, mở thêm tunnel cho GPU 1:
   ```python
   tunnel1 = subprocess.Popen(["./cloudflared", "tunnel", "--url", "http://localhost:8189"])
   ```
   Trong Kumanga, lưu URL GPU 0 làm Image Generation provider chính; thêm URL GPU 1 tại **Advanced — rotation & fallback → Add fallback provider**, chọn **ComfyUI (local)**, cùng model, rồi để chiến lược **Round robin**. Kumanga sẽ phân phối các request lần lượt qua hai instance. Hai server dùng chung thư mục model nên không cần tải checkpoint hai lần.
4. Mở tunnel để có URL public (dùng `cloudflared`, không cần tạo tài khoản):
   ```python
   !wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O cloudflared
   !chmod +x cloudflared
   import subprocess, time

   tunnel = subprocess.Popen(
       ["./cloudflared", "tunnel", "--url", "http://localhost:8188"],
       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
   )

   time.sleep(3)
   found = False
   for _ in range(60):  # tăng số dòng đọc
       line = tunnel.stdout.readline()
       if not line:
           time.sleep(0.5)
           continue
       print(line, end="")  # in hết ra để debug
       if "trycloudflare.com" in line and "https://" in line:
           found = True
           break

   if not found:
       print("Chưa tìm thấy URL, kiểm tra lại log phía trên.")
   ```
   Copy URL dạng `https://xxxx-xxxx.trycloudflare.com` in ra ở bước này.
5. Trong Kumanga: AI Settings → Image Generation → chọn **ComfyUI (local)** → Base URL = URL cloudflared vừa lấy → Model = tên file checkpoint bạn đã tải ở bước 2 (ví dụ `sd_xl_base_1.0.safetensors`) → **không cần** bật `ALLOW_PRIVATE_NETWORKS=1` (URL này là public thật) → Test Connection → Save.

**Lưu ý quan trọng:**
- Kaggle interactive session tự tắt sau một khoảng không hoạt động, và có giới hạn giờ GPU/tuần theo tài khoản — mỗi lần notebook restart, URL cloudflared **đổi mới hoàn toàn**, phải vào AI Settings dán lại Base URL.
- Với T4 x2, cần giữ **cả hai** ComfyUI process và **cả hai** tunnel sống; nếu một GPU/tunnel dừng, tạm xoá fallback tương ứng hoặc chuyển về một provider.
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
- **Lỗi "Background removal did not complete" khi tạo nhân vật bằng ComfyUI** — 2 nguyên nhân khác nhau, cùng một triệu chứng: (1) checkpoint không vẽ đúng nền trắng tinh như yêu cầu — xem phần "Chọn checkpoint/LoRA cho ComfyUI" trong mục [5b](#5b-dùng-model-ai-chạy-local--self-host-không-cần-api-cloud); (2) ảnh trả về **trắng/xám mờ, không có nội dung gì** (không phải nền trắng có nhân vật — mà toàn bộ ảnh gần như trống) — đây là bug VAE SDXL tràn số ở fp16 trên GPU T4, sửa bằng cờ `--fp32-vae` khi chạy ComfyUI, xem mục 5c.
- **Lỗi `missing_node_type: Node 'InspyrenetRembg' not found` khi dùng ComfyUI làm fallback tách nền** — node pack `ComfyUI-Inspyrenet-Rembg` chưa cài, hoặc đã cài nhưng ComfyUI chưa được restart (custom node chỉ nạp lúc khởi động). "Test Connection" vẫn báo "Connected" trong trường hợp này vì nó chỉ kiểm tra server phản hồi, không kiểm tra node — chỉ lộ ra khi tách nền thật. Xem lại lệnh cài + restart trong mục 5c.
- **Đổi sang checkpoint khác (không phải `sd_xl_base_1.0.safetensors`) ra ảnh gần như trống, chỉ vài đốm đen vô nghĩa** — dù đã tắt hết LoRA — checkpoint đó nhiều khả năng train theo **v-prediction** chứ không phải epsilon-prediction như SDXL gốc. Đổi AI Settings → Image Generation → "Advanced — ComfyUI settings" → **Prediction type** → **V-prediction**, xem mục 5b.
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

ComfyUI gets a dedicated adapter rather than a Custom API mapping because its protocol isn't plain REST: `/history/{prompt_id}` nests its result under a **dynamic** key — the `prompt_id` that was just submitted — and a full workflow graph is too large for the cookie-based config budget. The adapter builds the workflow server-side. Open "Advanced — ComfyUI settings" in AI Settings to tune steps/CFG/sampler/scheduler, use the "Fetch LoRAs"/"Fetch ControlNet models" buttons to pick from what ComfyUI actually has installed (no manual typing needed), and add up to 4 LoRAs (filename + strength). Generating a character/pose with a reference image also automatically switches to img2img (keeps the reference's identity while still allowing pose/expression changes). Local editing (paint a mask, ask the AI to redraw only that region) works with ComfyUI too, using its real mask-aware inpainting rather than a whole-image redo — if that edit also carries a character's identity reference (automatic when editing an asset belonging to a character that already has one), ComfyUI uses **IPAdapter** to keep that identity, no extra setup beyond installing the `ComfyUI_IPAdapter_plus` node pack (not part of a vanilla install — ComfyUI reports a clear error if it's missing, never a silent wrong result). Preset/weight are tunable in "Advanced — ComfyUI settings". **ControlNet** (matching a specific pose/line-art exactly): configure one ControlNet model in AI Settings, then attach a "Control image" when generating — you supply that image already pre-processed (e.g. an OpenPose skeleton render); Kumanga never runs pose/edge extraction itself. **Background-removal fallback via ComfyUI**: AI Settings → Background Removal → "Configure fallback" → pick **"ComfyUI (local)"** — uses a ComfyUI server (the same one running image generation, or a different one) with the `ComfyUI-Inspyrenet-Rembg` node pack installed (not part of a vanilla install). Fully independent from the ComfyUI choice used for image generation.

**Picking a checkpoint/LoRA for ComfyUI — avoiding "Background removal did not complete":**

When generating a character (a cutout-style asset), Kumanga always adds "isolated on a pure white background, no scenery" to the prompt, then **strips that background with a local algorithm** (flood-fill from the image edges — no AI involved in the removal step itself). The base SDXL checkpoint (`sd_xl_base_1.0.safetensors`) often **doesn't follow that instruction well** — it tends to draw a street or interior behind the character anyway — so the flood-fill finds no clean, edge-connected white region and fails with exactly that error. **Confirmed on a real Kaggle T4 run**: adding one line-art LoRA below to this same stock checkpoint fixes it — no checkpoint swap needed. (Switching to an anime-tag-trained checkpoint like Animagine XL 4.0, hoping for stronger prompt adherence, was also tried — but combined with a LoRA it produced near-blank/garbage output on ComfyUI 0.36.0; see the checkpoint table in section 5c below. Staying on the stock checkpoint is the more stable choice.)

**Important update — if switching to a different checkpoint produces near-blank output with a few meaningless dark blobs (even with every LoRA disabled):** this is usually **not a LoRA or prompt problem** — that checkpoint is likely trained **v-prediction** (some NoobAI-vpred and Illustrious-family variants), while Kumanga's workflow previously only supported **epsilon-prediction** (the stock SDXL style). Sampling a v-prediction checkpoint through an epsilon-only graph produces exactly that "near-blank + a few dark blobs" symptom. Kumanga now exposes this: AI Settings → Image Generation → "Advanced — ComfyUI settings" → **"Prediction type"** → set it to **"V-prediction"** if your checkpoint is one of those (check the checkpoint's own model card on Civitai/Hugging Face to be sure — don't guess from the name). The stock `sd_xl_base_1.0.safetensors` is epsilon, so leave this at the default for it.

| LoRA | Purpose | Source |
|---|---|---|
| Manga line-art LoRA | Pulls the line work toward Kumanga's default "Minimal Line Manga" monochrome style | [`artificialguybr/LineAniRedmond-LinearMangaSDXL-V2`](https://huggingface.co/artificialguybr/LineAniRedmond-LinearMangaSDXL-V2) (Hugging Face, direct download, no account needed) — trigger word `LineAniAF, lineart` |
| White background LoRA | Forces a genuinely plain white backdrop, so Kumanga's own background-removal step succeeds | [`White Background`](https://civitai.com/models/119388/white-background) (Civitai) — trigger phrase `with a white background`, strength around 1.0–1.2 |

Download onto whatever's running ComfyUI (e.g. the Kaggle notebook in section 5c below), into `ComfyUI/models/loras/`:
```python
# Manga line-art LoRA — Hugging Face, plain wget, no login
!wget -q -O ComfyUI/models/loras/LineAniRedmondV2-Lineart-LineAniAF.safetensors \
  "https://huggingface.co/artificialguybr/LineAniRedmond-LinearMangaSDXL-V2/resolve/main/LineAniRedmondV2-Lineart-LineAniAF.safetensors"

# White background LoRA — Civitai blocks anonymous downloads, needs your own API key
# (create one at civitai.com → Account Settings → API Keys), paste it in place of TOKEN
!wget -q -O ComfyUI/models/loras/white_1_0.safetensors \
  "https://civitai.com/api/download/models/129692?fileId=94019&token=TOKEN"
```
In Kumanga: AI Settings → Image Generation → open "Advanced — ComfyUI settings" → click "+ Add LoRA" → click "Fetch LoRAs" to pick the file you just downloaded (no manual typing). **Start with just the line-art LoRA** at strength **~0.5–0.6**, CFG left at its default (7) — confirmed to produce real characters with this combo on the stock checkpoint. The current Kumanga build also adds anti-floor/shadow/backdrop/panel terms to the negative prompt automatically (no setup needed), so the white-background LoRA above is often unnecessary now — add it only if the background still isn't clean, at a low strength (~0.3). Each LoRA row has an **"applies to"** field — for the white-background LoRA, pick **"Character/prop cutouts only"** (not "All generations"): a backdrop-biasing LoRA is counterproductive on a `background`-type generation (which wants a full scene), and this way it's simply skipped there automatically, no manual toggling needed when you switch between generating a character and a background. Use the **"Test generation"** button right in AI Settings (next to "Test Connection") to preview the raw output quickly without running the full Agent.

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
2. Install ComfyUI and download a checkpoint. Pick one of these four — all download directly from Hugging Face, no account needed:

   | Checkpoint | Good for | Size |
   |---|---|---|
   | **[`stabilityai/stable-diffusion-xl-base-1.0`](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0)** (recommended) | The stock model — confirmed working on a real Kaggle T4 run: paired with one line-art LoRA (section 5b above) it produces correctly-styled, stable characters | ~6.9 GB |
   | [`Minthy/RouWei-0.8`](https://huggingface.co/Minthy/RouWei-0.8) (file `rouwei_080_epsilon_fp16.safetensors`) | Trained on top of Illustrious, community-reported to follow prompts better than stock Illustrious/NoobAI — use the **`epsilon`** file (nothing to change in settings); if trying the `vpred` file instead, switch "Prediction type" to V-prediction in AI Settings (section 5b above); not yet verified on a live Kaggle T4 run the way the stock checkpoint was | ~6.9 GB |
   | [`cagliostrolab/animagine-xl-4.0`](https://huggingface.co/cagliostrolab/animagine-xl-4.0) | Trained on anime/manga tags, strong tag adherence — but **observed** on ComfyUI 0.36.0 (with its Dynamic VRAM/aimdo system): combined with a LoRA it repeatedly produced near-blank/garbage output, even though the same checkpoint alone (no LoRA) rendered real content fine. Unclear whether the checkpoint itself or its interaction with this specific ComfyUI build is at fault — test carefully before relying on it | ~6.9 GB |
   | [`OnomaAIResearch/Illustrious-XL-v2.0`](https://huggingface.co/OnomaAIResearch/Illustrious-XL-v2.0) | If you want compatibility with today's largest anime LoRA ecosystem — most new anime LoRAs/checkpoints on Civitai are trained on Illustrious as their base — not verified with the line-art LoRA above | ~6.9 GB |

   **A trap when browsing Civitai for a "B&W manga-specific" checkpoint**: some models named with an "IL" suffix (e.g. "Manga Vision IL") suggest "Illustrious", but are actually trained on a completely different architecture ("Anima" — a 16-channel VAE, flow-matching model, not SDXL's epsilon-prediction). That kind is **not compatible** with the SDXL LoRA already in use (LineAniRedmond) or with Kumanga's current ComfyUI graph (hard-coded for SDXL). Always check the actual "Base Model" field on the Civitai/Hugging Face page — never infer architecture from the name.

   One cell (using the stock checkpoint — swap the URL/filename for one of the other rows if you want to try a different one):
   ```python
   !git clone https://github.com/comfyanonymous/ComfyUI.git
   !pip install -r ComfyUI/requirements.txt -q

   !wget -q -O ComfyUI/models/checkpoints/sd_xl_base_1.0.safetensors \
     "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"

   # A different checkpoint — uncomment the matching two lines below instead of the stock one above:

   # RouWei 0.8 (the epsilon file, not vpred)
   # !wget -q -O ComfyUI/models/checkpoints/rouwei_080_epsilon_fp16.safetensors \
   #   "https://huggingface.co/Minthy/RouWei-0.8/resolve/main/rouwei_080_epsilon_fp16.safetensors"

   # Animagine XL 4.0 (see the LoRA warning in the table above)
   # !wget -q -O ComfyUI/models/checkpoints/animagine-xl-4.0.safetensors \
   #   "https://huggingface.co/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0.safetensors"

   # Illustrious LoRA ecosystem
   # !wget -q -O ComfyUI/models/checkpoints/Illustrious-XL-v2.0.safetensors \
   #   "https://huggingface.co/OnomaAIResearch/Illustrious-XL-v2.0/resolve/main/Illustrious-XL-v2.0.safetensors"
   ```
   Check the exact filename (and size — in case the download was incomplete) in its own cell:
   ```python
   !ls -la ComfyUI/models/checkpoints/
   ```
   Make sure **Model** in AI Settings matches whatever filename shows up there (e.g. `sd_xl_base_1.0.safetensors`).

   Want IPAdapter (identity-preserving local edits) on this Kaggle server too? Add, in the same cell or a separate one:
   ```python
   !git clone https://github.com/cubiq/ComfyUI_IPAdapter_plus.git ComfyUI/custom_nodes/ComfyUI_IPAdapter_plus
   # Also needs an IPAdapter model + CLIP vision model — see that repo's own README for the right download link for your checkpoint
   ```
   Want to use this same ComfyUI instance as a **background-removal fallback** (section 5 above) when Kumanga's built-in extraction fails? Add — **the 2nd `pip install` line is required**, skipping it fails the node import with `ModuleNotFoundError: No module named 'transparent_background'` (ComfyUI still starts fine; only that node fails to load):
   ```python
   !git clone https://github.com/john-mnz/ComfyUI-Inspyrenet-Rembg.git ComfyUI/custom_nodes/ComfyUI-Inspyrenet-Rembg
   !pip install -r ComfyUI/custom_nodes/ComfyUI-Inspyrenet-Rembg/requirements.txt -q
   # Downloads its model automatically on first use — nothing else to fetch
   ```
   **If ComfyUI was already running before you installed this node, stop it and re-run the start command in step 3 below.** Custom nodes only load at startup — without a restart, "Test Connection" still reports OK (it only checks the server responds, not that the node exists), but a real background-removal call fails with `missing_node_type: Node 'InspyrenetRembg' not found`.
3. Start the ComfyUI server in the background. **`--fp32-vae` is required** — the stock SDXL VAE overflows (NaN) running in fp16 on T4-class GPUs (a known SDXL bug, not specific to Kumanga), producing a blank/washed-out grey-white image with no real content instead of an actual error, easy to mistake for a bad prompt or checkpoint:
   ```python
   import subprocess
   subprocess.Popen(["python", "ComfyUI/main.py", "--listen", "0.0.0.0", "--port", "8188", "--fp32-vae"])
   ```
   **Using both GPUs on a T4 x2 session:** one ComfyUI process normally uses one GPU. If Kaggle provides two GPUs, run two independent instances, pin each one to a different GPU, and give them separate ports. **A separate `--database-url` per instance is required** — both run from the same `ComfyUI/` folder, so without this they default to the same database file and the second one to start fails with `Database is locked` (the error message itself names the fix; skipping it is easy to misread as the two processes genuinely conflicting):
   ```python
   import os, subprocess

   def start_comfyui(gpu, port):
       env = os.environ.copy()
       env["CUDA_VISIBLE_DEVICES"] = str(gpu)
       return subprocess.Popen([
           "python", "ComfyUI/main.py", "--listen", "0.0.0.0",
           "--port", str(port), "--cuda-device", "0", "--fp32-vae",
           "--database-url", f"sqlite:///comfyui_gpu{gpu}.db",
       ], env=env)

   comfyui_gpu0 = start_comfyui(0, 8188)
   comfyui_gpu1 = start_comfyui(1, 8189)
   ```
   These two instances process **two requests concurrently**; they do not make one image render twice as fast. Step 4 already opens the tunnel for GPU 0; after downloading `cloudflared` and making it executable, open an additional tunnel for GPU 1:
   ```python
   tunnel1 = subprocess.Popen(["./cloudflared", "tunnel", "--url", "http://localhost:8189"])
   ```
   In Kumanga, save the GPU 0 URL as the primary Image Generation provider; add the GPU 1 URL under **Advanced — rotation & fallback → Add fallback provider**, choose **ComfyUI (local)** with the same model, and leave the strategy on **Round robin**. Kumanga will distribute requests across both instances. Both servers share the model directory, so the checkpoint does not need to be downloaded twice.
4. Open a tunnel to get a public URL (using `cloudflared`, no account needed):
   ```python
   !wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O cloudflared
   !chmod +x cloudflared
   import subprocess, time

   tunnel = subprocess.Popen(
       ["./cloudflared", "tunnel", "--url", "http://localhost:8188"],
       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
   )

   time.sleep(3)
   found = False
   for _ in range(60):  # read more lines than before
       line = tunnel.stdout.readline()
       if not line:
           time.sleep(0.5)
           continue
       print(line, end="")  # print everything, for debugging
       if "trycloudflare.com" in line and "https://" in line:
           found = True
           break

   if not found:
       print("URL not found yet — check the log above.")
   ```
   Copy the printed `https://xxxx-xxxx.trycloudflare.com` URL.
5. In Kumanga: AI Settings → Image Generation → pick **ComfyUI (local)** → Base URL = the cloudflared URL you just got → Model = the checkpoint filename you downloaded in step 2 (e.g. `sd_xl_base_1.0.safetensors`) → **no need** to enable `ALLOW_PRIVATE_NETWORKS=1` (this is a real public URL) → Test Connection → Save.

**Important caveats:**
- A Kaggle interactive session shuts down after a period of inactivity, and GPU hours are capped per week per account — every time the notebook restarts, the cloudflared URL **changes completely**, so you'll need to paste the new Base URL into AI Settings again.
- With T4 x2, keep **both** ComfyUI processes and **both** tunnels alive; if one GPU/tunnel stops, temporarily remove that fallback or switch back to one provider.
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
- **"Background removal did not complete" when generating a character with ComfyUI** — two different causes, same symptom: (1) the checkpoint isn't drawing the plain white background it was asked for — see "Picking a checkpoint/LoRA for ComfyUI" in [section 5b](#5b-using-a-localself-hosted-ai-model-no-cloud-api-needed); (2) the returned image is **blank/washed-out grey-white with no real content at all** (not "white background with a character on it" — the whole image) — this is the SDXL VAE fp16-overflow bug on T4 GPUs, fixed with the `--fp32-vae` flag when starting ComfyUI, see section 5c.
- **`missing_node_type: Node 'InspyrenetRembg' not found` when using ComfyUI as the background-removal fallback** — the `ComfyUI-Inspyrenet-Rembg` node pack isn't installed, or was installed but ComfyUI was never restarted (custom nodes only load at startup). "Test Connection" still reports "Connected" here — it only checks that the server responds, not that the node exists — so this only shows up on a real background-removal call. See the install + restart steps in section 5c.
- **Switching to a different checkpoint (not `sd_xl_base_1.0.safetensors`) produces near-blank output with a few meaningless dark blobs** — even with every LoRA disabled — that checkpoint is likely trained **v-prediction**, not epsilon-prediction like the stock SDXL base. Set AI Settings → Image Generation → "Advanced — ComfyUI settings" → **Prediction type** → **V-prediction**, see section 5b.
- **Want to use a local model (Ollama/LM Studio/Automatic1111)** — see [section 5b](#5b-using-a-localself-hosted-ai-model-no-cloud-api-needed) above.
- **Want to use Azure OpenAI, or run image models on Kaggle's free GPU** — see [section 5c](#5c-azure-openai-agent--running-image-models-on-kaggles-free-gpu-image-generation) above.
- **Want to deploy to Vercel** — see [`manga-studio/docs/DEPLOYMENT.md`](../manga-studio/docs/DEPLOYMENT.md) for the full walkthrough.

### 8. Related documentation

- [`../CLAUDE.md`](../CLAUDE.md) / [`../AGENTS.md`](../AGENTS.md) — guidance for AI coding agents working in this repo.
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — overall architecture diagram.
- [`RELEASE_FREEZE_V0.1.md`](RELEASE_FREEZE_V0.1.md) — current v0.1 baseline status.
- [`../manga-studio/docs/AI_PROVIDER_ARCHITECTURE.md`](../manga-studio/docs/AI_PROVIDER_ARCHITECTURE.md) — provider abstraction details.
