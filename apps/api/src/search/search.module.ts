import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { GlobalSearchController, SearchController } from "./search.controller";
import { SearchRepository } from "./search.repository";
import { SearchService } from "./search.service";

@Module({
  imports: [AuthModule],
  controllers: [SearchController, GlobalSearchController],
  providers: [SearchRepository, SearchService],
  exports: [SearchService],
})
export class SearchModule {}
