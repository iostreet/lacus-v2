import os
from supabase import create_client, Client

# Strip whitespace from env var names to handle Railway dashboard tab/space issues
_env = {k.strip(): v for k, v in os.environ.items()}

SUPABASE_URL      = _env.get("SUPABASE_URL",      "https://pzodkufrnnjkbghyfwth.supabase.co")
SUPABASE_ANON_KEY = _env.get("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB6b2RrdWZybm5qa2JnaHlmd3RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMzg2ODAsImV4cCI6MjA5MjgxNDY4MH0.Z_WF2-VVFKTiGF2V4DEcabZYgdxeW_feO4eqcfu1rqU")
SUPABASE_SERVICE_KEY = _env.get("SUPABASE_SERVICE_KEY", "")

# Admin client uses service role key (bypasses RLS) — required for background tasks
supabase_admin: Client = create_client(
    SUPABASE_URL,
    SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY,
)

if not SUPABASE_SERVICE_KEY:
    import warnings
    warnings.warn(
        "SUPABASE_SERVICE_KEY is not set. Background analysis tasks may fail. "
        "Get it from Supabase dashboard → Settings → API → service_role.",
        RuntimeWarning,
    )
