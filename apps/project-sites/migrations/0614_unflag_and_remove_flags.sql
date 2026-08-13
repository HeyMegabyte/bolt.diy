-- 0614_unflag_and_remove_flags.sql
-- Two operations on 8 manifest-free flags (verified: no libs/features module owns
-- them, so removing the registry entry does NOT orphan a manifest / break the
-- feature-architecture drift gate — the mistake 0613/442e1d82 made on manifest-backed
-- flags, since reverted):
--
--  REMOVE (feature cut): swarm_editor, collab_editing. collab's route guard
--    (routes/collab.ts) now fail-closes (isFlagOn on an unknown key → false → 404);
--    swarm's /admin/swarm route is unguarded, so its frontend route/component removal
--    is the finishing step (tracked for the next loop fire).
--
--  UN-FLAG (feature kept, gate dropped): domain_stack_wizard, log_explorer,
--    multimodal_copilot, public_api, section_marketplace, site_dna_taste_graph.
--    All were stable/100%; the isFlagOn checks were removed from their routes
--    (domain_stack.ts, logs.ts, copilot.ts) so the features are now unconditional.
--
-- This clears any stray runtime overrides so flag_overrides has nothing dangling.

DELETE FROM flag_overrides WHERE flag_key IN (
  'swarm_editor', 'collab_editing',
  'domain_stack_wizard', 'log_explorer', 'multimodal_copilot',
  'public_api', 'section_marketplace', 'site_dna_taste_graph'
);
