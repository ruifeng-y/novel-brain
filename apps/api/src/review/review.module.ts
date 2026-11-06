import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ChaptersModule } from "../chapters/chapters.module";
import { QualityController } from "./quality.controller";
import { QualityRepository } from "./quality.repository";
import { QualityService } from "./quality.service";
import { ReviewController } from "./review.controller";
import { ReviewRepository } from "./review.repository";
import { ReviewService } from "./review.service";

@Module({
  imports: [AuthModule, ChaptersModule],
  controllers: [ReviewController, QualityController],
  providers: [ReviewRepository, ReviewService, QualityRepository, QualityService],
})
export class ReviewModule {}
