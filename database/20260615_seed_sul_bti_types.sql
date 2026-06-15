INSERT INTO sul_bti_types (
  type_code,
  type_name,
  description
)
VALUES
  ('SHFC', 'SHFC', '술BTI 유형 SHFC'),
  ('SHFU', 'SHFU', '술BTI 유형 SHFU'),
  ('SHMC', 'SHMC', '술BTI 유형 SHMC'),
  ('SHMU', 'SHMU', '술BTI 유형 SHMU'),
  ('SLFC', 'SLFC', '술BTI 유형 SLFC'),
  ('SLFU', 'SLFU', '술BTI 유형 SLFU'),
  ('SLMC', 'SLMC', '술BTI 유형 SLMC'),
  ('SLMU', 'SLMU', '술BTI 유형 SLMU'),
  ('DHFC', 'DHFC', '술BTI 유형 DHFC'),
  ('DHFU', 'DHFU', '술BTI 유형 DHFU'),
  ('DHMC', 'DHMC', '술BTI 유형 DHMC'),
  ('DHMU', 'DHMU', '술BTI 유형 DHMU'),
  ('DLFC', 'DLFC', '술BTI 유형 DLFC'),
  ('DLFU', 'DLFU', '술BTI 유형 DLFU'),
  ('DLMC', 'DLMC', '술BTI 유형 DLMC'),
  ('DLMU', 'DLMU', '술BTI 유형 DLMU')
ON CONFLICT (type_code) DO UPDATE
SET
  type_name = COALESCE(sul_bti_types.type_name, EXCLUDED.type_name),
  description = COALESCE(sul_bti_types.description, EXCLUDED.description);
