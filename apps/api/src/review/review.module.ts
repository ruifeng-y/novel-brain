import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ChaptersModule } from "../chapters/chapters.module";
import { ReviewController } from "./review.controller";
import { ReviewRepository } from "./review.repository";
import { ReviewService } from "./review.service";

@Module({
  imports: [AuthModule, ChaptersModule],
  controllers: [ReviewController],
  providers: [ReviewRepository, ReviewService],
})
export class ReviewModule {}
