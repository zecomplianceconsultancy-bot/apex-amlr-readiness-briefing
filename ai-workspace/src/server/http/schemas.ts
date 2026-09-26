import { z } from "zod";
import { CLASSIFICATIONS } from "@/server/security/data-policy";

export const loginSchema = z.object({ email: z.email().max(320), password: z.string().min(1).max(1000) });

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  classification: z.enum(CLASSIFICATIONS).default("internal"),
  piiRedaction: z.boolean().default(true),
  context: z.string().max(100_000).optional(),
});

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000),
    classification: z.enum(CLASSIFICATIONS),
    piiRedaction: z.boolean(),
    defaultModelId: z.string().max(200).nullable(),
  })
  .partial();

export const saveContextSchema = z.object({ content: z.string().max(100_000) });

export const upsertMemberSchema = z.object({ email: z.email(), role: z.enum(["owner", "editor", "viewer"]) });

export const createConversationSchema = z.object({ title: z.string().trim().min(1).max(200).optional() });
export const updateConversationSchema = z.object({ title: z.string().trim().min(1).max(200).optional(), archived: z.boolean().optional() });

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(100_000),
  modelId: z.string().max(200).nullable().optional(),
});

export const updateFileSchema = z.object({ includeInContext: z.boolean() });
