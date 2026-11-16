import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AccountLifecycleController } from "./account-lifecycle.controller";
import { AccountLifecycleRepository } from "./account-lifecycle.repository";
import { AccountLifecycleService } from "./account-lifecycle.service";
import { AccountPurgeQueue } from "./account-purge.queue";

@Module({
  imports: [AuthModule],
  controllers: [AccountLifecycleController],
  providers: [AccountLifecycleRepository, AccountPurgeQueue, AccountLifecycleService],
  exports: [AccountLifecycleService],
})
export class AccountLifecycleModule {}
