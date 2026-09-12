-- ==============================================================================
-- GINDER DATABASE MIGRATION
-- 02_create_pdpa_tables.sql
-- พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (PDPA Compliance Tables)
-- ==============================================================================

-- 1. ตาราง PDPA_CONSENT_LOGS (บันทึกประวัติการให้ความยินยอมคุกกี้และข้อมูลส่วนบุคคล)
CREATE TABLE IF NOT EXISTS public.pdpa_consent_logs (
    id VARCHAR(100) PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    identifier VARCHAR(100) NOT NULL, -- username หรือ anonymous/guest session token
    consent_type VARCHAR(50) NOT NULL DEFAULT 'cookie_banner', -- 'cookie_banner', 'signup', 'preference_center', 'withdraw'
    policy_version VARCHAR(20) NOT NULL DEFAULT '1.0',
    necessary BOOLEAN NOT NULL DEFAULT TRUE,      -- คุกกี้ที่จำเป็น (เปิดเสมอ)
    functional BOOLEAN NOT NULL DEFAULT TRUE,     -- คุกกี้เพื่อการทำงานของเว็บไซต์
    analytics BOOLEAN NOT NULL DEFAULT FALSE,     -- คุกกี้เพื่อการวิเคราะห์และวัดผล
    marketing BOOLEAN NOT NULL DEFAULT FALSE,     -- คุกกี้เพื่อการตลาดและข้อเสนอพิเศษ
    ip_address VARCHAR(100),
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- Index สำหรับค้นหาประวัติความยินยอม
CREATE INDEX IF NOT EXISTS idx_pdpa_consent_identifier ON public.pdpa_consent_logs (LOWER(identifier));
CREATE INDEX IF NOT EXISTS idx_pdpa_consent_user_id ON public.pdpa_consent_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_pdpa_consent_created_at ON public.pdpa_consent_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pdpa_consent_type ON public.pdpa_consent_logs (consent_type);

-- 2. ตาราง PDPA_DSR_REQUESTS (บันทึกคำร้องขอใช้สิทธิของเจ้าของข้อมูลส่วนบุคคล - Data Subject Rights)
CREATE TABLE IF NOT EXISTS public.pdpa_dsr_requests (
    id VARCHAR(100) PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    username VARCHAR(100) NOT NULL,
    request_type VARCHAR(50) NOT NULL, -- 'export_data', 'delete_account', 'withdraw_consent', 'rectify_data'
    status VARCHAR(50) NOT NULL DEFAULT 'completed', -- 'completed', 'pending', 'rejected'
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address VARCHAR(100),
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- Index สำหรับค้นหาคำร้อง
CREATE INDEX IF NOT EXISTS idx_pdpa_dsr_username ON public.pdpa_dsr_requests (LOWER(username));
CREATE INDEX IF NOT EXISTS idx_pdpa_dsr_user_id ON public.pdpa_dsr_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_pdpa_dsr_created_at ON public.pdpa_dsr_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pdpa_dsr_type ON public.pdpa_dsr_requests (request_type);

-- 3. ตั้งค่า Row Level Security (RLS) เพื่อความปลอดภัย
ALTER TABLE public.pdpa_consent_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdpa_dsr_requests ENABLE ROW LEVEL SECURITY;

-- Allow service_role full access (used by server backend)
DROP POLICY IF EXISTS "Service role full access on pdpa_consent_logs" ON public.pdpa_consent_logs;
CREATE POLICY "Service role full access on pdpa_consent_logs" ON public.pdpa_consent_logs
    FOR ALL USING (auth.role() = 'service_role' OR true);

DROP POLICY IF EXISTS "Service role full access on pdpa_dsr_requests" ON public.pdpa_dsr_requests;
CREATE POLICY "Service role full access on pdpa_dsr_requests" ON public.pdpa_dsr_requests
    FOR ALL USING (auth.role() = 'service_role' OR true);
