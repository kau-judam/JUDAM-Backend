DROP INDEX IF EXISTS public.uq_sul_bti_results_user_id;

CREATE INDEX IF NOT EXISTS idx_sul_bti_results_user_latest
ON public.sul_bti_results (user_id, updated_at DESC, result_id DESC);
