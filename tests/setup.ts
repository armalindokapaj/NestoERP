import { config } from "dotenv";

/**
 * Loads the local environment so integration tests reach the same PostgreSQL
 * the application uses. CI supplies DATABASE_URL directly and this is a no-op
 * there (PRD #9 §125).
 */
config({ path: ".env", quiet: true });
