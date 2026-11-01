export type RedisConnectionOptions = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
};

export function parseRedisConnection(value: string): RedisConnectionOptions {
  const url = new URL(value);
  const dbValue = url.pathname.replace(/^\//, '');
  const connection: RedisConnectionOptions = {
    host: url.hostname || 'localhost',
    port: url.port ? Number(url.port) : 6379,
  };

  if (url.username) {
    connection.username = decodeURIComponent(url.username);
  }
  if (url.password) {
    connection.password = decodeURIComponent(url.password);
  }
  if (dbValue) {
    connection.db = Number(dbValue);
  }

  return connection;
}
