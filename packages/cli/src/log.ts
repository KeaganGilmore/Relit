import pino from 'pino';

export const createLogger = (correlationId: string, level = 'info') =>
  pino({
    level,
    base: { correlationId },
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname,correlationId',
        singleLine: true,
      },
    },
  });

export type Logger = ReturnType<typeof createLogger>;
