import { SetMetadata } from "@nestjs/common";

export const ALLOW_ACCOUNT_DELETION_PENDING = "allow-account-deletion-pending";
export const AllowAccountDeletionPending = () => SetMetadata(ALLOW_ACCOUNT_DELETION_PENDING, true);
