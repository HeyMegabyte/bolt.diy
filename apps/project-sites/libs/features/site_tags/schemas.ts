import { z } from 'zod';

/** Valid tag colors — tailwind-ish named hues. */
export const TAG_COLORS = [
  'slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber',
  'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue',
  'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
] as const;
export type TagColor = (typeof TAG_COLORS)[number];

/** Create a new tag for an org. */
export const CreateTagSchema = z.object({
  name: z.string().min(1).max(64),
  color: z.enum(TAG_COLORS).default('blue'),
  emoji: z.string().max(8).optional(),
}).strict();
export type CreateTagInput = z.infer<typeof CreateTagSchema>;

/** Update an existing tag's display properties. */
export const UpdateTagSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  color: z.enum(TAG_COLORS).optional(),
  emoji: z.string().max(8).nullable().optional(),
}).strict();
export type UpdateTagInput = z.infer<typeof UpdateTagSchema>;

/** Attach tags to a site. */
export const SetSiteTagsSchema = z.object({
  tagIds: z.array(z.string().uuid()).max(20),
}).strict();
export type SetSiteTagsInput = z.infer<typeof SetSiteTagsSchema>;

/** Tag record as returned from D1. */
export interface TagRow {
  id: string;
  org_id: string;
  name: string;
  color: TagColor;
  emoji: string | null;
  site_count: number;
  created_at: string;
}

/** Tag response shape. */
export const TagResponseSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string(),
  color: z.enum(TAG_COLORS),
  emoji: z.string().nullable(),
  siteCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type TagResponse = z.infer<typeof TagResponseSchema>;

/** List tags for an org. */
export const ListTagsResponseSchema = z.object({
  data: z.array(TagResponseSchema),
});
export type ListTagsResponse = z.infer<typeof ListTagsResponseSchema>;
