# Report Manager

เว็บภายในทีมสำหรับบันทึกและสรุปสถานะ Live Event feeds โดยใช้ Firebase Authentication และ Firestore

## Phase 1: Data safety

- การลบจากหน้าเว็บเป็น soft delete และกู้คืนจากถังขยะได้ 30 วัน
- ก่อนแก้ไข ลบ หรือย้อนกลับ ระบบเก็บ snapshot เดิมใน `feeds/{id}/history`
- ผู้ใช้ที่ล็อกอินทุกคนเปิดประวัติและกู้คืนได้
- GitHub Actions สำรองข้อมูลและประวัติเป็น JSON ทุกวัน เก็บ artifact 30 วัน
- cleanup ทำงานหลัง upload artifact สำเร็จเท่านั้น
- ไม่มีปุ่มลบถาวรในหน้าเว็บ

## เปิดใช้ Daily Backup (ครั้งเดียว)

1. เปลี่ยน repository เป็น **Private** ก่อน เพราะ artifact มีข้อมูลจริงของทีม
2. Firebase Console → Project settings → Service accounts → Generate new private key
3. GitHub → Settings → Secrets and variables → Actions → New repository secret
4. ตั้งชื่อ `FIREBASE_SERVICE_ACCOUNT` และวาง JSON ทั้งไฟล์เป็นค่า Secret
5. GitHub → Actions → Daily Firestore backup → Run workflow เพื่อทดสอบครั้งแรก
6. ตรวจว่า run สำเร็จและมี artifact ดาวน์โหลดได้ ก่อนนำ Phase 1 ไปใช้กับข้อมูลจริง

อย่า commit ไฟล์ service-account JSON ลง repository

## Firestore Rules

ไฟล์ `firestore.rules` เป็น rules ที่แนะนำสำหรับทีมนี้: ผู้ใช้ต้องล็อกอิน, หน้าเว็บลบถาวรไม่ได้ และ history แก้ไขย้อนหลังไม่ได้ การเพิ่มไฟล์นี้ยังไม่ deploy rules ให้อัตโนมัติ ต้องนำไปตรวจและ deploy ใน Firebase Console แยกต่างหาก

## ตรวจสคริปต์ในเครื่อง

```bash
npm ci
npm run check
```

การรัน backup/cleanup ต้องมี environment variable `FIREBASE_SERVICE_ACCOUNT` และจะเชื่อมต่อข้อมูลจริง จึงควรรันผ่าน GitHub Actions เท่านั้น
