import { jobEventSchema, type JobEvent } from "@novel-brain/contracts";
import { LogRedactionError, sanitizeLogPayloadStrict } from "@novel-brain/core";

export function sanitizeJobEventForDelivery(event: JobEvent): JobEvent {
  try {
    return jobEventSchema.parse({
      ...event,
      data: sanitizeLogPayloadStrict(event.data),
    });
  } catch (error) {
    if (error instanceof LogRedactionError) {
      return jobEventSchema.parse({
        ...event,
        data: { code: "SENSITIVE_PAYLOAD_REDACTED" },
      });
    }
    throw error;
  }
}
