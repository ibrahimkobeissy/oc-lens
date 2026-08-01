import { fileURLToPath } from "node:url";
import path from "node:path";

const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));

export const POPULATED_DB_PATH = path.join(FIXTURES_DIR, "populated.db");
export const EMPTY_DB_PATH = path.join(FIXTURES_DIR, "empty.db");
