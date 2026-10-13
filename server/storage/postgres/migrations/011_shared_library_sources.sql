-- A parsed original belongs to an account; courses reference it without copying it.
ALTER TABLE custom_assets ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE custom_assets ADD COLUMN IF NOT EXISTS wk_kb_id VARCHAR(80);
ALTER TABLE custom_assets ADD COLUMN IF NOT EXISTS library_file_id UUID;
UPDATE custom_assets a SET owner_id = c.owner_id, wk_kb_id = c.wk_doc_kb_id
FROM custom_courses c WHERE a.course_id = c.id AND (a.owner_id IS NULL OR a.wk_kb_id IS NULL);
ALTER TABLE custom_assets ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE custom_assets ALTER COLUMN wk_kb_id SET NOT NULL;
ALTER TABLE custom_assets ALTER COLUMN course_id DROP NOT NULL;
ALTER TABLE custom_assets DROP CONSTRAINT IF EXISTS custom_assets_course_id_fkey;
ALTER TABLE custom_assets ADD CONSTRAINT custom_assets_course_id_fkey FOREIGN KEY(course_id) REFERENCES custom_courses(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS custom_assets_library_file_idx ON custom_assets(library_file_id) WHERE library_file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS custom_assets_owner_idx ON custom_assets(owner_id);

CREATE TABLE IF NOT EXISTS custom_course_assets (
  course_id UUID NOT NULL REFERENCES custom_courses(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES custom_assets(id) ON DELETE CASCADE,
  asset_role VARCHAR(24) NOT NULL CHECK (asset_role IN ('lecture','lab','syllabus','reading')),
  PRIMARY KEY (course_id, asset_id)
);
INSERT INTO custom_course_assets(course_id,asset_id,asset_role)
SELECT course_id,id,asset_role FROM custom_assets WHERE course_id IS NOT NULL ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS library_parse_spaces (
  owner_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  wk_kb_id UUID NOT NULL UNIQUE,
  ready BOOLEAN NOT NULL DEFAULT FALSE
);
