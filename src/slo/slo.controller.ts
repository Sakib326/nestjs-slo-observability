import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { ErrorBudgetService } from './error-budget.service';
import { SLOService } from './slo.service';
import {
  ControllerEnabledGuard,
  ControllerType,
} from '../core/controller-enabled.guard';

@Controller('slo')
@UseGuards(ControllerEnabledGuard)
@ControllerType('slo')
export class SLOController {
  constructor(
    private readonly sloService: SLOService,
    private readonly errorBudgetService: ErrorBudgetService,
  ) {}

  @Get()
  list() {
    return this.sloService.getAll();
  }

  @Get(':name/budget')
  budget(@Param('name') name: string) {
    if (!this.sloService.has(name)) {
      throw new NotFoundException(`SLO "${name}" not found.`);
    }
    return this.errorBudgetService.getBudget(name);
  }
}
