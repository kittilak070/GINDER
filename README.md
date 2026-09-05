# Kinder 🍽️
**Kinder Restaurant Matchmaking Platform**

ระบบจับคู่และค้นหาร้านอาหารแบบ Interactive Matching พร้อมระบบ Admin Dashboard, User Account, และ Real-time Collaboration

## 🚀 คุณสมบัติเด่น (Features)
- 🍔 **Restaurant Matchmaking**: สุ่มและจับคู่ร้านอาหารแบบ Interactive Swiping
- 👥 **Group / Session Matching**: สร้างห้องและจับคู่กับเพื่อนแบบ Real-time (Socket.IO)
- 🔐 **Authentication & Recovery**: ระบบสมาชิก Login, Register และ Password Recovery
- ⚙️ **Admin Dashboard**: จัดการรายการร้านอาหาร รีวิว และฟีดแบ็กจากผู้ใช้งาน
- ☁️ **Supabase Integration**: จัดเก็บข้อมูลร้านอาหารและระบบฐานข้อมูล

## 🛠️ วิธีการติดตั้งและรันโปรเจกต์ (Getting Started)

### 1. ติดตั้ง Dependencies
```bash
npm install
```

### 2. กำหนดค่า Environment Variables
คัดลอกไฟล์ `.env.example` ไปเป็น `.env`:
```bash
cp .env.example .env
```
จากนั้นแก้ไขข้อมูลใน `.env` ให้ตรงกับ Supabase Project และค่า Secret ของคุณ:
```env
SUPABASE_URL="https://your-supabase-project.supabase.co"
SUPABASE_ANON_KEY="your-supabase-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-supabase-service-role-key"
SESSION_SECRET="your-session-secret"
```

### 3. รันเซิร์ฟเวอร์
```bash
npm start
```
เปิดบราวเซอร์ที่ [http://localhost:3000](http://localhost:3000) (หรือพอร์ตที่กำหนด)
