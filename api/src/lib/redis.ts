import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL;

export const redis = redisUrl
  ? new Redis(redisUrl, { maxRetriesPerRequest: 3, lazyConnect: true })
  : null;

if (redis) {
  redis.on('error', (err) => {
    console.warn('[redis] error', err.message);
  });
  void redis.connect().catch((err) => {
    console.warn('[redis] connect failed', err.message);
  });
}
