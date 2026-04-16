import Fastify from 'fastify';

const app = Fastify({
  logger: true
});

app.get('/', async () => {
  return { message: 'SoftConnect API running 🚀' };
});

app.get('/health', async () => {
  return { status: 'ok' };
});

const start = async () => {
  try {
    await app.listen({ port: 3000, host: '0.0.0.0' });
    console.log('ci: force dev pipeline v0.1.0-dev.1');
    console.log('Server running on port 3000');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();