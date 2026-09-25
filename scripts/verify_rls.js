require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function verifyRLS() {
    console.log('====================================================');
    console.log('  SUPABASE ROW LEVEL SECURITY (RLS) AUDIT CHECK');
    console.log('====================================================\n');

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env');
        process.exit(1);
    }

    const anonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const serviceClient = process.env.SUPABASE_SERVICE_ROLE_KEY 
        ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
        : null;

    const tables = ['feedbacks', 'match_history', 'users', 'restaurants', 'user_security'];

    let allProtected = true;

    for (const table of tables) {
        const { data, count, error, status } = await anonClient
            .from(table)
            .select('*', { count: 'exact', head: true });

        const isExposed = !error && count !== null && count > 0;

        if (isExposed) {
            allProtected = false;
            console.log(`❌ [VULNERABLE] Table "${table}": Public anon key can read ${count} rows (HTTP ${status})`);
        } else {
            console.log(`✅ [SECURED] Table "${table}": Public anon access blocked (count: ${count || 0})`);
        }
    }

    console.log('\n----------------------------------------------------');
    if (allProtected) {
        console.log('🎉 EXCELLENT! RLS is fully ACTIVE and all tables are protected against anon data leaks.');
    } else {
        console.log('⚠️ ACTION REQUIRED: RLS is still DISABLED on one or more tables.');
        console.log('Please copy and run the SQL commands in Supabase SQL Editor to enable RLS.');
    }
    console.log('====================================================\n');
}

verifyRLS().catch(err => {
    console.error('Audit script error:', err);
    process.exit(1);
});
