import type { z } from "zod";

import { HttpError } from "./errors.js";

export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(400, result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}
