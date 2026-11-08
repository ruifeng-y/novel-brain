import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
  type SchemaObject,
} from "@nestjs/swagger";
import {
  itemConsumeRequestSchema,
  itemCreateRequestSchema,
  itemEquipRequestSchema,
  itemListResponseSchema,
  itemPatchRequestSchema,
  itemResponseSchema,
  itemRightGrantRequestSchema,
  itemRightResponseSchema,
  itemUnequipRequestSchema,
  powerPathCreateRequestSchema,
  powerPathResponseSchema,
  powerRealmCreateRequestSchema,
  powerRealmResponseSchema,
  powerSystemCreateRequestSchema,
  powerSystemListResponseSchema,
  powerSystemPatchRequestSchema,
  powerSystemResponseSchema,
  specialMechanismCreateRequestSchema,
  specialMechanismListResponseSchema,
  specialMechanismOwnershipTransferRequestSchema,
  specialMechanismPatchRequestSchema,
  specialMechanismResponseSchema,
  uuidV7Schema,
  worldSnapshotQuerySchema,
} from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { getClientIp } from "../auth/client-ip";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PowerItemsService } from "./power-items.service";

function schemaOf(schema: z.ZodType, io: "input" | "output"): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const powerSystemCreateBodySchema = schemaOf(powerSystemCreateRequestSchema, "input");
const powerSystemPatchBodySchema = schemaOf(powerSystemPatchRequestSchema, "input");
const powerPathCreateBodySchema = schemaOf(powerPathCreateRequestSchema, "input");
const powerRealmCreateBodySchema = schemaOf(powerRealmCreateRequestSchema, "input");
const mechanismCreateBodySchema = schemaOf(specialMechanismCreateRequestSchema, "input");
const mechanismPatchBodySchema = schemaOf(specialMechanismPatchRequestSchema, "input");
const mechanismTransferBodySchema = schemaOf(
  specialMechanismOwnershipTransferRequestSchema,
  "input",
);
const itemCreateBodySchema = schemaOf(itemCreateRequestSchema, "input");
const itemPatchBodySchema = schemaOf(itemPatchRequestSchema, "input");
const itemRightBodySchema = schemaOf(itemRightGrantRequestSchema, "input");
const itemConsumeBodySchema = schemaOf(itemConsumeRequestSchema, "input");
const itemEquipBodySchema = schemaOf(itemEquipRequestSchema, "input");
const unequipBodySchema = schemaOf(itemUnequipRequestSchema, "input");

const powerSystemSchema = schemaOf(powerSystemResponseSchema, "output");
const powerSystemListSchema = schemaOf(powerSystemListResponseSchema, "output");
const powerPathSchema = schemaOf(powerPathResponseSchema, "output");
const powerRealmSchema = schemaOf(powerRealmResponseSchema, "output");
const mechanismSchema = schemaOf(specialMechanismResponseSchema, "output");
const mechanismListSchema = schemaOf(specialMechanismListResponseSchema, "output");
const itemSchema = schemaOf(itemResponseSchema, "output");
const itemListSchema = schemaOf(itemListResponseSchema, "output");
const itemRightSchema = schemaOf(itemRightResponseSchema, "output");

@ApiTags("world")
@Controller("works/:workId/branches/:branchId/world")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class PowerItemsController {
  constructor(private readonly service: PowerItemsService) {}

  @Get("power-systems")
  @ApiOkResponse({ description: "Power systems", schema: powerSystemListSchema })
  async listPowerSystems(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Query() query: unknown,
  ) {
    return powerSystemListResponseSchema.parse({
      data: await this.service.listPowerSystems(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        worldSnapshotQuerySchema.parse(query),
      ),
      requestId: createRequestId(),
      meta: {},
    });
  }

  @Post("power-systems")
  @HttpCode(201)
  @ApiBody({ schema: powerSystemCreateBodySchema })
  @ApiCreatedResponse({ description: "Created power system", schema: powerSystemSchema })
  async createPowerSystem(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return powerSystemResponseSchema.parse({
      data: await this.service.createPowerSystem(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        powerSystemCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("power-systems/:powerSystemId")
  @ApiOkResponse({ description: "Power system detail", schema: powerSystemSchema })
  async getPowerSystem(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("powerSystemId") powerSystemId: string,
    @Query() query: unknown,
  ) {
    return powerSystemResponseSchema.parse({
      data: await this.service.getPowerSystem(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(powerSystemId),
        worldSnapshotQuerySchema.parse(query),
      ),
      requestId: createRequestId(),
      meta: {},
    });
  }

  @Patch("power-systems/:powerSystemId")
  @ApiBody({ schema: powerSystemPatchBodySchema })
  @ApiOkResponse({ description: "Updated power system", schema: powerSystemSchema })
  async updatePowerSystem(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("powerSystemId") powerSystemId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return powerSystemResponseSchema.parse({
      data: await this.service.updatePowerSystem(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(powerSystemId),
        powerSystemPatchRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("power-systems/:powerSystemId/paths")
  @HttpCode(201)
  @ApiBody({ schema: powerPathCreateBodySchema })
  @ApiCreatedResponse({ description: "Created power path", schema: powerPathSchema })
  async addPowerPath(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("powerSystemId") powerSystemId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return powerPathResponseSchema.parse({
      data: await this.service.addPowerPath(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(powerSystemId),
        powerPathCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("power-systems/:powerSystemId/paths/:pathId/realms")
  @HttpCode(201)
  @ApiBody({ schema: powerRealmCreateBodySchema })
  @ApiCreatedResponse({ description: "Created power realm", schema: powerRealmSchema })
  async addPowerRealm(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("powerSystemId") powerSystemId: string,
    @Param("pathId") pathId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return powerRealmResponseSchema.parse({
      data: await this.service.addPowerRealm(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(powerSystemId),
        uuidV7Schema.parse(pathId),
        powerRealmCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("mechanisms")
  @ApiOkResponse({ description: "Special mechanisms", schema: mechanismListSchema })
  async listMechanisms(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Query() query: unknown,
  ) {
    return specialMechanismListResponseSchema.parse({
      data: await this.service.listMechanisms(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        worldSnapshotQuerySchema.parse(query),
      ),
      requestId: createRequestId(),
      meta: {},
    });
  }

  @Post("mechanisms")
  @HttpCode(201)
  @ApiBody({ schema: mechanismCreateBodySchema })
  @ApiCreatedResponse({ description: "Created special mechanism", schema: mechanismSchema })
  async createMechanism(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return specialMechanismResponseSchema.parse({
      data: await this.service.createMechanism(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        specialMechanismCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("mechanisms/:mechanismId")
  @ApiOkResponse({ description: "Special mechanism detail", schema: mechanismSchema })
  async getMechanism(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("mechanismId") mechanismId: string,
    @Query() query: unknown,
  ) {
    return specialMechanismResponseSchema.parse({
      data: await this.service.getMechanism(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(mechanismId),
        worldSnapshotQuerySchema.parse(query),
      ),
      requestId: createRequestId(),
      meta: {},
    });
  }

  @Patch("mechanisms/:mechanismId")
  @ApiBody({ schema: mechanismPatchBodySchema })
  @ApiOkResponse({ description: "Updated special mechanism", schema: mechanismSchema })
  async updateMechanism(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("mechanismId") mechanismId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return specialMechanismResponseSchema.parse({
      data: await this.service.updateMechanism(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(mechanismId),
        specialMechanismPatchRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("mechanisms/:mechanismId/ownership-transfers")
  @HttpCode(201)
  @ApiBody({ schema: mechanismTransferBodySchema })
  @ApiCreatedResponse({ description: "Transferred special mechanism", schema: mechanismSchema })
  async transferMechanismOwnership(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("mechanismId") mechanismId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return specialMechanismResponseSchema.parse({
      data: await this.service.transferMechanismOwnership(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(mechanismId),
        specialMechanismOwnershipTransferRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("items")
  @ApiOkResponse({ description: "Items and resources", schema: itemListSchema })
  async listItems(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Query() query: unknown,
  ) {
    return itemListResponseSchema.parse({
      data: await this.service.listItems(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        worldSnapshotQuerySchema.parse(query),
      ),
      requestId: createRequestId(),
      meta: {},
    });
  }

  @Post("items")
  @HttpCode(201)
  @ApiBody({ schema: itemCreateBodySchema })
  @ApiCreatedResponse({ description: "Created item", schema: itemSchema })
  async createItem(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return itemResponseSchema.parse({
      data: await this.service.createItem(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        itemCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("items/:itemId")
  @ApiOkResponse({ description: "Item detail", schema: itemSchema })
  async getItem(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("itemId") itemId: string,
    @Query() query: unknown,
  ) {
    return itemResponseSchema.parse({
      data: await this.service.getItem(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(itemId),
        worldSnapshotQuerySchema.parse(query),
      ),
      requestId: createRequestId(),
      meta: {},
    });
  }

  @Patch("items/:itemId")
  @ApiBody({ schema: itemPatchBodySchema })
  @ApiOkResponse({ description: "Updated item", schema: itemSchema })
  async updateItem(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return itemResponseSchema.parse({
      data: await this.service.updateItem(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(itemId),
        itemPatchRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("items/:itemId/rights")
  @HttpCode(201)
  @ApiBody({ schema: itemRightBodySchema })
  @ApiCreatedResponse({ description: "Created item right", schema: itemRightSchema })
  async grantItemRight(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return itemRightResponseSchema.parse({
      data: await this.service.grantItemRight(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(itemId),
        itemRightGrantRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("items/:itemId/consume")
  @HttpCode(200)
  @ApiBody({ schema: itemConsumeBodySchema })
  @ApiOkResponse({ description: "Consumed item", schema: itemSchema })
  async consumeItem(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return itemResponseSchema.parse({
      data: await this.service.consumeItem(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(itemId),
        itemConsumeRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("items/:itemId/equip")
  @HttpCode(200)
  @ApiBody({ schema: itemEquipBodySchema })
  @ApiOkResponse({ description: "Equipped item", schema: itemSchema })
  async equipItem(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return itemResponseSchema.parse({
      data: await this.service.equipItem(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(itemId),
        itemEquipRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("items/:itemId/unequip")
  @HttpCode(200)
  @ApiBody({ schema: unequipBodySchema })
  @ApiOkResponse({ description: "Unequipped item", schema: itemSchema })
  async unequipItem(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    const input = itemUnequipRequestSchema.parse(body);
    return itemResponseSchema.parse({
      data: await this.service.unequipItem(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(itemId),
        input.version,
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  private userId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw new Error("Authenticated request is missing auth context");
    }
    return request.auth.user.id;
  }

  private auditContext(request: AuthenticatedRequest, requestId: string) {
    const userAgent = String(request.headers["user-agent"] ?? "").trim();
    return {
      requestId,
      ip: getClientIp(request) || "unknown",
      userAgent: userAgent || "unknown",
    };
  }
}
