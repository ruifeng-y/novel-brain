import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { CharactersController } from "./characters.controller";
import { CharactersRepository } from "./characters.repository";
import { CharactersService } from "./characters.service";

@Module({
  imports: [AuthModule],
  controllers: [CharactersController],
  providers: [CharactersRepository, CharactersService],
  exports: [CharactersService],
})
export class CharactersModule {}
