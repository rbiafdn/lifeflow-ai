// Test veritabanı: lifeflow_test (önce `npm run test:db` ile migrasyon uygulanır)
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5434/lifeflow_test?schema=public";
process.env.JWT_SECRET = "test-secret-test-secret-test-secret";
process.env.NODE_ENV = "test";
delete process.env.ANTHROPIC_API_KEY;
