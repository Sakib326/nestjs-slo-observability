import {
  Controller,
  Get,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { HealthService } from './health.service';
import {
  ControllerEnabledGuard,
  ControllerType,
} from '../core/controller-enabled.guard';

@Controller('health')
@UseGuards(ControllerEnabledGuard)
@ControllerType('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check() {
    const res = await this.healthService.checkAll();
    if (res.status === 'down') {
      throw new ServiceUnavailableException(res);
    }
    return res;
  }
}
