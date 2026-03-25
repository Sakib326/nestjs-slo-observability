import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OBSERVABILITY_MODULE_OPTIONS } from './observability.constants';
import { ResolvedObservabilityModuleOptions } from './observability.types';

export const CONTROLLER_TYPE_KEY = 'observability:controller_type';
export const ControllerType = (type: 'metrics' | 'slo' | 'health') =>
  SetMetadata(CONTROLLER_TYPE_KEY, type);

@Injectable()
export class ControllerEnabledGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(OBSERVABILITY_MODULE_OPTIONS)
    private readonly options: ResolvedObservabilityModuleOptions,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const controllerType = this.reflector.getAllAndOverride<'metrics' | 'slo' | 'health'>(
      CONTROLLER_TYPE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (controllerType && this.options.controllers?.[controllerType] === false) {
      throw new NotFoundException();
    }

    return true;
  }
}
