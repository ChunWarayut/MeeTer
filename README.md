# MVP Meeter — สุ่มคุย VIDEO CALL 1-1 (MVP)

โปรเจกต์ตัวอย่าง MVP สำหรับสุ่มจับคู่คนสองคนเพื่อคุยแบบวิดีโอคอล 1:1 ด้วย WebRTC และใช้ WebSocket เป็น signaling server ภายใน

คุณสมบัติหลัก
- ค้นหา/จับคู่แบบสุ่มทีละคู่
- วิดีโอ/เสียงแบบ P2P ผ่าน WebRTC (ใช้ STUN สาธารณะ)
- UI เรียบง่าย หน้าเดียว

เริ่มต้นใช้งาน
1) ติดตั้ง Node.js (แนะนำ v18+)
2) ติดตั้ง dependencies
```
npm install
```
3) รันเซิร์ฟเวอร์
```
npm start
```
4) เปิดเบราว์เซอร์เข้า `http://localhost:3030` สองแท็บ (หรือสองเครื่อง) เพื่อทดสอบการจับคู่

ตั้งค่า STUN/TURN (เพิ่มความเสถียร)
- ค่าเริ่มต้นจะใช้ STUN สาธารณะของ Google อยู่แล้ว
- สามารถเพิ่ม TURN ได้โดยตั้ง Environment Variables ก่อนรันเซิร์ฟเวอร์:
```
TURN_URL=turn:your.turn.server:3478 \
TURN_USERNAME=youruser \
TURN_PASSWORD=yourpass \
node server.js
```
- หรือส่ง ICE servers แบบกำหนดเองเป็น JSON ทั้งชุด:
```
ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:host:3478","username":"u","credential":"p"}]' node server.js
```

ฟีเจอร์เพิ่มเติม
- ปุ่มปิดไมค์/ปิดกล้อง และสลับกล้อง (มือถือ)
- “ถัดไปอัตโนมัติ” ใส่เวลาวินาทีเพื่อเปลี่ยนคู่โดยอัตโนมัติ
- ป้องกันจับคู่ซ้ำช่วงสั้นๆ (cooldown) ด้วย `COOLDOWN_MS` (ค่าเริ่มต้น 60000ms)
- เก็บ metrics พื้นฐาน: `/metrics` (JSON) และ healthcheck `/healthz`
- จำกัดอัตราการส่งสัญญาณ (rate-limit) ป้องกัน spam (`SIGNAL_LIMIT`/`SIGNAL_WINDOW_MS`)

Docker
```
docker build -t mvp-meeter .
docker run -p 3030:3030 \
  -e TURN_URL=turn:your.turn.server:3478 \
  -e TURN_USERNAME=youruser \
  -e TURN_PASSWORD=yourpass \
  mvp-meeter
```
เปิดใช้งานที่ `http://localhost:3030`

GitHub Actions (Build & Publish to GHCR)
- Workflow `.github/workflows/docker-publish.yml` จะ build และ push อัตโนมัติไปยัง GitHub Container Registry (GHCR)
- ชื่ออิมเมจจะเป็น `ghcr.io/<owner>/<repo>` เช่น `ghcr.io/yourname/mvp-meeter`
- การใช้งาน:
  - สร้าง repo บน GitHub และ push โค้ดขึ้นสาขา `main`
  - เมื่อติดแท็กเวอร์ชัน `vX.Y.Z` ก็จะถูก push tag ด้วย เช่น `ghcr.io/yourname/mvp-meeter:v1.0.0`
  - ดึงอิมเมจมาใช้: `docker pull ghcr.io/<owner>/<repo>:<tag>`
  - ตรวจสอบแพ็คเกจได้ที่หน้า Packages ของ repo

Conventional Commits + Auto Versioning (release-please)
- ใช้ workflow `.github/workflows/release-please.yml` เพื่อสร้าง PR อัปเดตเวอร์ชัน/CHANGELOG อัตโนมัติเมื่อมี commit ใหม่เข้า `main`
- ตั้งค่าด้วย `release-please-config.json` และ `.release-please-manifest.json`
- วิธีการใช้งาน (แนะนำ):
  - ใช้ข้อความ commit ตามมาตรฐาน Conventional Commits เช่น `feat: add auto-next timer`, `fix: requeue on next`
  - เมื่อมีการ merge เข้าสาขา `main`, bot จะเปิด PR ชื่อ `chore(main): release <version>` ให้ตรวจและ merge
  - เมื่อ merge PR นี้ ระบบจะสร้าง GitHub Release + อัปเดต `CHANGELOG.md` และ bump เวอร์ชันใน `package.json` ให้อัตโนมัติ
  - Tag/Release ที่ถูกสร้างจะไปกระตุ้น workflow Docker ให้ build/push image อัตโนมัติ

ตรวจสอบรูปแบบ PR/commit
- Semantic PR title: `.github/workflows/semantic-pr.yml` ตรวจชื่อหัวข้อ PR ให้เป็นรูปแบบ Conventional Commits
- Commit message lint: ติดตั้ง dev deps และ husky (optional):
  ```
  npm install
  npx husky install
  ```
  ระบบจะมี hook `commit-msg` รัน `commitlint` ตรวจข้อความ commit ให้อัตโนมัติ

โครงสร้าง
- `server.js` — Express + WebSocket (`ws`) สำหรับเสิร์ฟหน้าเว็บและทำหน้าที่ signaling + matchmaker
- `public/index.html` — หน้า UI หลัก
- `public/client.js` — โค้ดฝั่ง Client จัดการ WebRTC และสื่อสารกับ signaling server

ข้อจำกัดของ MVP
- ใช้ STUN สาธารณะของ Google; หากเครือข่ายซับซ้อนอาจต้องตั้งค่า TURN เอง
- ไม่รองรับหลายคู่คุยพร้อมกันในหน้าจอเดียว (ทำ 1:1 เท่านั้น)
- ไม่มีระบบบัญชีผู้ใช้/ยืนยันตัวตน/ยืนยันอายุ ฯลฯ

ไอเดียต่อยอด
- เพิ่ม TURN server (เช่น coturn) เพื่อให้เชื่อมต่อได้เสถียรในทุกเครือข่าย
- เพิ่มระบบ report/ban, time limit ต่อคู่, กด next เพื่อสุ่มคู่ใหม่
- เก็บสถิติ session, เพิ่มคิวแยกตามภาษา/ความสนใจ
