import { Controller, Get, UseGuards } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import {
  ControllerEnabledGuard,
  ControllerType,
} from '../core/controller-enabled.guard';

@Controller('metrics')
@UseGuards(ControllerEnabledGuard)
@ControllerType('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  snapshot() {
    return this.metricsService.getSnapshot();
  }
}
