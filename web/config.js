// Public browser configuration. Replace these placeholders with YOUR project values.
export const SUPABASE_URL='https://your-project-ref.supabase.co';
export const SUPABASE_KEY='YOUR_SUPABASE_PUBLISHABLE_KEY';
export const SUPABASE_PROJECT_REF=new URL(SUPABASE_URL).hostname.split('.')[0];
export const SUPABASE_SQL_EDITOR='https://supabase.com/dashboard/project/'+SUPABASE_PROJECT_REF+'/sql/new';
