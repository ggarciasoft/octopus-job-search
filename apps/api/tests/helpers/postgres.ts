/**
 * Ephemeral PostgreSQL for the API test suite.
 *
 * 11_TESTING_ACCEPTANCE.md requires "Node domain/API tests against real
 * ephemeral PostgreSQL for scope, constraints, revisions and leases". There is
 * no in-memory substitute here: `FOR UPDATE SKIP LOCKED`, advisory locks,
 * composite foreign keys and partial unique indexes are the behaviour under
 * test, and a mock would assert nothing.
 *
 * One container is started per *test file* (`beforeAll`), not per test:
 * per-test containers would dominate the run time, and a single shared
 * container would couple unrelated files.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * PostgreSQL 17 is the baseline in 02_ARCHITECTURE.md. The image is
 * overridable so CI can point at a mirror without a code change — useful when
 * Docker Hub's anonymous pull rate limit (HTTP 429) is in play.
 */
export const TEST_POSTGRES_IMAGE = process.env['TEST_POSTGRES_IMAGE'] ?? 'postgres:17-alpine';

export interface TestDatabase {
  readonly container: StartedPostgreSqlContainer;
  readonly connectionString: string;
  stop(): Promise<void>;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(TEST_POSTGRES_IMAGE)
    .withDatabase('job_getter_test')
    .withUsername('job_getter')
    .withPassword('job_getter')
    // The suite drives several concurrent claim transactions; the default of
    // 100 is ample but the setting is made explicit so a future change to the
    // concurrency tests fails loudly rather than flaking.
    .withCommand(['postgres', '-c', 'max_connections=100', '-c', 'fsync=off'])
    .start();

  return {
    container,
    connectionString: container.getConnectionUri(),
    async stop() {
      await container.stop();
    },
  };
}
