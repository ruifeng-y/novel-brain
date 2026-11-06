import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { StyleController } from "./style.controller";
import { StyleRepository } from "./style.repository";
import { StyleService } from "./style.service";

@Module({
  imports: [AuthModule],
  controllers: [StyleController],
  providers: [StyleRepository, StyleService],
})
export class StyleModule {}
