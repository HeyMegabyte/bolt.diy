INSERT INTO feature_flags (id, org_id, flag_name, enabled, metadata_json)
VALUES ('flag_cms_collections', NULL, 'cms_collections', 0,
  '{"stage":"experimental","rollout_percent":0,"description":"Dynamic CMS content types with relationships. 7 built-in templates: team, services, testimonials, portfolio, events, faq, menu_items. Supports 10 field types including reference fields between collections, multi-select, and dynamic routing.","owner_email":"brian@megabyte.space","e2e_tests":["e2e/cms_collections/model.spec.ts"]}');
