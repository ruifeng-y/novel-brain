import { describe, expect, it } from "vitest";

import type { ObjectStorage } from "@novel-brain/storage";

import { WorkPurgeProcessor } from "../src/works/work-purge.processor";
import type { WorkerWorkPurgeRepository } from "../src/works/work-purge.repository";

describe("WorkPurgeProcessor", () => {
  it("deletes due work objects and continues after a blocked work", async () => {
    const purged: string[][] = [];
    const repository = {
      listDueWorkIds: async () => ["blocked", "ready"],
      preparePurge: async (workId: string) => {
        if (workId === "blocked") {
          throw new Error("blocked by export");
        }
        return ["exports/ready.txt", "covers/ready.webp"];
      },
      purge: async () => true,
    } as unknown as WorkerWorkPurgeRepository;
    const storage = {
      putObject: async () => undefined,
      getObject: async () => new Uint8Array(),
      deleteObject: async () => undefined,
      deleteObjects: async (keys: string[]) => {
        purged.push(keys);
      },
    } satisfies ObjectStorage;

    const processor = new WorkPurgeProcessor(repository, storage);

    await expect(processor.cleanupDue()).resolves.toBe(1);
    expect(purged).toEqual([["exports/ready.txt", "covers/ready.webp"]]);
  });
});
