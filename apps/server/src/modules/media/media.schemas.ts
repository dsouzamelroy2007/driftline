import { z } from "zod";

import { MAX_ATTACHMENT_BYTES, MEDIA_CONTENT_TYPES } from "./media.service.js";

export const uploadUrlRequestSchema = z.object({
  contentType: z.enum(MEDIA_CONTENT_TYPES),
  size: z
    .number()
    .int()
    .positive()
    .max(MAX_ATTACHMENT_BYTES, `File must be ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB or smaller`),
});

export type UploadUrlRequest = z.infer<typeof uploadUrlRequestSchema>;
