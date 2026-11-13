import { Module } from "@nestjs/common";
import {
  GOLDEN_THREE_CONTEXT_COMPILER,
  GoldenThreeRepository,
  type GoldenThreeContextCompiler,
} from "@novel-brain/golden-three";

import { AuthModule } from "../auth/auth.module";
import { GenerationModule } from "../generation/generation.module";
import { ApiGoldenThreeContextCompiler } from "./golden-three-context.compiler";
import { GoldenThreeController } from "./golden-three.controller";
import { GoldenThreeQueue } from "./golden-three.queue";
import { GoldenThreeService } from "./golden-three.service";

@Module({
  imports: [AuthModule, GenerationModule],
  controllers: [GoldenThreeController],
  providers: [
    ApiGoldenThreeContextCompiler,
    {
      provide: GOLDEN_THREE_CONTEXT_COMPILER,
      inject: [ApiGoldenThreeContextCompiler],
      useFactory: (compiler: ApiGoldenThreeContextCompiler) => compiler,
    },
    {
      provide: GoldenThreeRepository,
      inject: [GOLDEN_THREE_CONTEXT_COMPILER],
      useFactory: (compiler: GoldenThreeContextCompiler) => new GoldenThreeRepository(compiler),
    },
    GoldenThreeQueue,
    GoldenThreeService,
  ],
  exports: [GoldenThreeService],
})
export class GoldenThreeModule {}
