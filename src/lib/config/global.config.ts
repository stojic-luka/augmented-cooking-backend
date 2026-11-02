import { registerAs } from '@nestjs/config';

export default registerAs('Global', () => ({
  Port: Number(process.env.PORT) || 3000,
  Environment: process.env.NODE_ENV || 'development',
  CorsOrigin: process.env.CORS_ORIGIN || true,
}));
