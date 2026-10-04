import { z } from "zod";

/** Request bodies of /api/admin/* (PRD §11: every JSON body is zod-validated). */

export const Slug = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, digits and single dashes");

const Title = z.string().trim().min(2).max(300);
const Uuid = z.uuid();

export const CreateModuleBody = z.object({
  slug: Slug,
  title: Title,
  description: z.string().trim().max(1000).nullish(),
});

export const PatchModuleBody = z
  .object({
    title: Title.optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    status: z.enum(["draft", "published", "archived"]).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Nothing to change");

export const OrderBody = z.object({ order: z.array(Uuid).min(1).max(500) });

export const PaperOrderBody = OrderBody.extend({ moduleId: Uuid });

export const CreatePaperBody = z.object({
  moduleId: Uuid,
  slug: Slug,
  title: Title,
  authors: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  year: z.number().int().min(1900).max(2100).nullable().default(null),
});

export const PatchPaperBody = z.union([
  z
    .object({
      title: Title.optional(),
      authors: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
      year: z.number().int().min(1900).max(2100).nullable().optional(),
    })
    .strict()
    .refine((b) => Object.keys(b).length > 0, "Nothing to change"),
  z.object({ moduleId: Uuid }).strict(),
  z.object({ retired: z.boolean() }).strict(),
]);

/** FR-6.7: typing the slug confirms; research retention must be ticked when it applies. */
export const DeleteBody = z.object({
  confirmSlug: z.string(),
  researchChecked: z.boolean().default(false),
});

export const CreateVersionBody = z.object({
  filename: z.string().min(1).max(300),
  sizeBytes: z.number().int().positive(),
});

export const PutGuideBody = z.object({ yaml: z.string().max(200_000) });

export const ApproveBody = z.object({ guideHash: z.string().min(1).max(64).optional() });

export const RetryBody = z.object({
  extractor: z.enum(["unpdf", "docling"]).nullable().default(null),
});

export const TestChatBody = z
  .object({
    clientMessageId: Uuid,
    /** The test conversation to continue; omitted → a new test chat (the previous one closes). */
    conversationId: Uuid.optional(),
    text: z.string().max(4000).optional(),
    event: z.enum(["stuck", "mode_switch"]).optional(),
    mode: z.enum(["understand", "apply", "critique", "build"]).optional(),
  })
  .refine(
    (b) =>
      b.event === "mode_switch" ? !!b.mode && !!b.conversationId : !(b.text?.trim() && b.event),
    "Send text, an event, or nothing (to start)",
  );
