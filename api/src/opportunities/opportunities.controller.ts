import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { OpportunitiesService } from './opportunities.service.js';
import {
  changeStageSchema,
  createOpportunitySchema,
  listOpportunitiesQuerySchema,
  registerContactSchema,
  updateOpportunitySchema,
  type ChangeStageInput,
  type CreateOpportunityInput,
  type ListOpportunitiesQuery,
  type RegisterContactInput,
  type UpdateOpportunityInput,
} from './opportunity.schemas.js';

const uuid = new ParseUUIDPipe({ version: '4' });

@Controller('opportunities')
export class OpportunitiesController {
  constructor(
    @Inject(OpportunitiesService)
    private readonly service: OpportunitiesService,
  ) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listOpportunitiesQuerySchema))
    query: ListOpportunitiesQuery,
  ) {
    return this.service.list(query);
  }

  @Get(':id')
  findOne(@Param('id', uuid) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createOpportunitySchema))
    body: CreateOpportunityInput,
  ) {
    return this.service.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(updateOpportunitySchema))
    body: UpdateOpportunityInput,
  ) {
    return this.service.update(id, body);
  }

  /** Mover de etapa é um comando com regras próprias, não um PATCH de campo. */
  @Post(':id/stage-transitions')
  @HttpCode(200)
  changeStage(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(changeStageSchema)) body: ChangeStageInput,
  ) {
    return this.service.changeStage(id, body);
  }

  @Post(':id/contacts')
  @HttpCode(200)
  registerContact(
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(registerContactSchema))
    body: RegisterContactInput,
  ) {
    return this.service.registerContact(id, body);
  }
}
