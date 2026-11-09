import { z } from "zod";

export const profileSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/, "id must be lowercase alphanumeric with hyphens only"),
    schemaVersion: z.literal("1.0"),
    name: z.string().min(1).max(60),
    description: z.string().max(240).optional(),
    themeId: z.string().min(1),
  })
  .strict();

export type Profile = z.infer<typeof profileSchema>;

export function safeParseProfile(input: unknown): ReturnType<typeof profileSchema.safeParse> {
  return profileSchema.safeParse(input);
}
