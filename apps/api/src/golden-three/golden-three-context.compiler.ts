import { Injectable } from "@nestjs/common";
import type { ContextPackPreview } from "@novel-brain/contracts";
import type { GoldenThreeContextCompiler } from "@novel-brain/golden-three";

import { GenerationService } from "../generation/generation.service";

@Injectable()
export class ApiGoldenThreeContextCompiler implements GoldenThreeContextCompiler {
  constructor(private readonly generation: GenerationService) {}

  compile(
    userId: string,
    input: { workId: string; branchId: string; chapterId: string },
    tokenBudget: number,
  ): Promise<ContextPackPreview> {
    return this.generation.contextPreview(userId, input, tokenBudget);
  }
}
