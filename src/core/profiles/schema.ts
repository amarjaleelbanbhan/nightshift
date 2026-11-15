import { z } from "zod";

// z.strictObject is Zod 4's form of Zod 3's `.object({...}).strict()` - unknown keys are
// rejected, not stripped. `.strict()` still exists in Zod 4 but is deprecated, and a
// silently-removed `.strict()` would downgrade this to key-stripping, so the construction
// is spelled out here instead. tests/unit/profile-schema.test.ts asserts the rejection.
export const profileSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/, "id must be lowercase alphanumeric with hyphens only"),
  schemaVersion: z.literal("1.0"),
  name: z.string().min(1).max(60),
  description: z.string().max(240).optional(),
  themeId: z.string().min(1),
});

export type Profile = z.infer<typeof profileSchema>;

export function safeParseProfile(input: unknown): ReturnType<typeof profileSchema.safeParse> {
  return profileSchema.safeParse(input);
}
