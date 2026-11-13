import { jobEventSchema, type JobEvent } from "@novel-brain/contracts";
import {
  LogRedactionError,
  parseLogCanaryValues,
  sanitizeStructuredPayload,
} from "@novel-brain/core";

export function sanitizeJobEventForDelivery(
  event: JobEvent,
  canaryValues: readonly string[] = parseLogCanaryValues(process.env.LOG_CANARY_VALUES),
): JobEvent {
  try {
    return jobEventSchema.parse({
      ...event,
      data: sanitizeStructuredPayload(event.data, { canaryValues }),
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
