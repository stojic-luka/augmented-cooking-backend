import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';

@Injectable()
export class RequestCancellationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const req = httpContext.getRequest<Request & { abortSignal: AbortSignal }>();
    const controller = new AbortController();

    req.abortSignal = controller.signal;
    req.on('close', () => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    });

    return next.handle();
  }
}
