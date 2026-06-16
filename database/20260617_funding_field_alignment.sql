ALTER TABLE IF EXISTS funding_drafts
ADD COLUMN IF NOT EXISTS schedule_summary TEXT;

ALTER TABLE IF EXISTS funding_drafts
ADD COLUMN IF NOT EXISTS business_classification VARCHAR(100);

ALTER TABLE IF EXISTS funding_projects
ADD COLUMN IF NOT EXISTS total_quantity INTEGER;
