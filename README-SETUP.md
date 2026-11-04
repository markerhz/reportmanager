# ขั้นตอนการติดตั้ง Sync Google Sheets เข้า ReportManager

ชุดไฟล์นี้ออกแบบมาสำหรับโปรเจกต์ `markerhz/reportmanager` เพื่อซิงก์ข้อมูลจาก Google Sheet `Event Schedule` เข้า Firestore อัตโนมัติทุกชั่วโมง

---

### ขั้นตอนการนำไฟล์ไปวางใน GitHub
1. คัดลอกไฟล์ทั้ง 3 ไฟล์ไปวางใน repository `markerhz/reportmanager`:
   - `.github/workflows/sync-sheets.yml`
   - `scripts/sync-sheets.mjs`
   - `package.json`
2. Commit และ Push ขึ้น branch `main`

---

### ขั้นตอนการตั้งค่า GitHub Secrets (ทำครั้งเดียว)
ไปที่ GitHub repo ของคุณ > **Settings** > **Secrets and variables** > **Actions** > กดปุ่ม **New repository secret**:
1. Secret แรก:
   - Name: `SPREADSHEET_ID`
   - Secret: `1hW9Fpuil8y71ie6tV6e7Z3c7ViqwIRJAMnrkM0K-YYU`
2. Secret ที่สอง:
   - Name: `GCP_SA_KEY`
   - Secret: วาง JSON Content ทั้งหมดของ Service Account Key (จาก Firebase / Google Cloud Console)

---

### อย่าลืมแชร์สิทธิ์ Google Sheet ให้ Service Account
1. เปิดไฟล์ Google Sheet [AIS_PLAY_Engineer_Resource_Precheck_Template](https://docs.google.com/spreadsheets/d/1hW9Fpuil8y71ie6tV6e7Z3c7ViqwIRJAMnrkM0K-YYU/edit)
2. กดปุ่ม **แชร์ (Share)** ด้านบนขวา
3. ใส่อีเมล `client_email` ของ Service Account (เช่น `xxx@your-project.iam.gserviceaccount.com`)
4. ให้สิทธิ์เป็น **Viewer (ผู้มีสิทธิ์อ่าน)** แล้วกดบันทึก

---

### วิธีทดสอบรัน
1. ไปที่แท็บ **Actions** บน GitHub
2. เลือกเวิร์กโฟลว์ **Sync Google Sheets to Firestore** ทางซ้าย
3. กดปุ่ม **Run workflow** ด้านขวา
4. รอประมาณ 30 วินาที เมื่อขึ้นเครื่องหมายถูกสีเขียว ข้อมูลฟีดและ Assign ทั้งหมดจะถูกซิงก์เข้า Firestore อัตโนมัติทันที
