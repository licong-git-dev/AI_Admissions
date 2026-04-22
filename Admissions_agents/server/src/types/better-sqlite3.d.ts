declare module 'better-sqlite3' {
  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface Statement {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }

  class Database {
    constructor(filename: string);
    pragma(source: string): unknown;
    exec(source: string): unknown;
    prepare(source: string): Statement;
    transaction<T>(fn: () => T): () => T;
  }

  export default Database;
}
