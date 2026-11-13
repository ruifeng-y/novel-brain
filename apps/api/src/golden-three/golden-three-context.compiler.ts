import { Injectable } from "@nestjs/common";
import type { ContextPackPreview } from "@novel-brain/contracts";
import type { GoldenThreeContextCompiler, GoldenThreeJobScope } from "@novel-brain/golden-three";

// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GenerationService } from "../generation/generation.service";

@Injectable()
export class ApiGoldenThreeContextCompiler implements GoldenThreeContextCompiler {
  constructor(private readonly generation: GenerationService) {}

  compile(
    userId: string,
    input: GoldenThreeJobScope,
    tokenBudget: number,
  ): Promise<ContextPackPreview> {
    return this.generation.contextPreview(
      userId,
      { workId: input.workId, branchId: input.branchId, chapterId: input.chapterId },
      tokenBudget,
    );
  }
}
