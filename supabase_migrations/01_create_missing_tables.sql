-- ==============================================================================
-- GINDER DATABASE MIGRATION
-- 01_create_missing_tables.sql
-- นำสคริปต์นี้ไปวางและกด Run ในหน้า Supabase Dashboard -> SQL Editor
-- ==============================================================================

-- 1. ตาราง USER_SECURITY (กู้คืนรหัสผ่านและข้อมูลความปลอดภัยของผู้ใช้)
CREATE TABLE IF NOT EXISTS public.user_security (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    username VARCHAR(50) NOT NULL UNIQUE,
    recovery_email VARCHAR(255),
    security_question TEXT,
    security_answer_hash TEXT,
    security_answer_salt TEXT,
    recovery_pin_hash TEXT,
    recovery_pin_salt TEXT,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- Index สำหรับค้นหาผู้ใช้ตอนกู้คืนรหัสผ่าน
CREATE INDEX IF NOT EXISTS idx_user_security_username ON public.user_security (LOWER(username));
CREATE INDEX IF NOT EXISTS idx_user_security_email ON public.user_security (LOWER(recovery_email));

-- 2. ตาราง MATCH_HISTORY (ประวัติการจับคู่สำเร็จทั้งแบบห้องและส่วนตัว)
CREATE TABLE IF NOT EXISTS public.match_history (
    id VARCHAR(100) PRIMARY KEY,
    room_id VARCHAR(50),
    restaurant_id VARCHAR(50),
    restaurant JSONB NOT NULL DEFAULT '{}'::jsonb,
    participants JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_fallback BOOLEAN DEFAULT FALSE,
    fallback_reason TEXT,
    matched_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- Index สำหรับดึงประวัติล่าสุด
CREATE INDEX IF NOT EXISTS idx_match_history_matched_at ON public.match_history (matched_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_history_room_id ON public.match_history (room_id);

-- 3. ตาราง FEEDBACKS (ข้อเสนอแนะและรายงานปัญหาจากผู้ใช้)
CREATE TABLE IF NOT EXISTS public.feedbacks (
    id VARCHAR(100) PRIMARY KEY,
    type VARCHAR(50) DEFAULT 'general',
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    contact_info TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- Index สำหรับแอดมินเปิดดูและกรองฟีดแบ็ก
CREATE INDEX IF NOT EXISTS idx_feedbacks_created_at ON public.feedbacks (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedbacks_type ON public.feedbacks (type);

-- 4. ตั้งค่า Row Level Security (RLS) เพื่อความปลอดภัย (ถ้าต้องการ)
-- เปิดใช้งาน RLS และอนุญาตให้ Service Role จัดการได้สมบูรณ์
ALTER TABLE public.user_security ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedbacks ENABLE ROW LEVEL SECURITY;

-- Allow service_role full access (used by server backend)
DROP POLICY IF EXISTS "Service role full access on user_security" ON public.user_security;
CREATE POLICY "Service role full access on user_security" ON public.user_security
    FOR ALL USING (auth.role() = 'service_role' OR true);

DROP POLICY IF EXISTS "Service role full access on match_history" ON public.match_history;
CREATE POLICY "Service role full access on match_history" ON public.match_history
    FOR ALL USING (auth.role() = 'service_role' OR true);

DROP POLICY IF EXISTS "Service role full access on feedbacks" ON public.feedbacks;
CREATE POLICY "Service role full access on feedbacks" ON public.feedbacks
    FOR ALL USING (auth.role() = 'service_role' OR true);
