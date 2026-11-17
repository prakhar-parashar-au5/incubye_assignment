#!/usr/bin/env node
// Thin entry point: creates the database named by the injected DATABASE_URL
// if it does not exist. Idempotent. Never reads .env files or prints the URL.
import { CreateDatabaseError, createDatabaseIfMissing } from '../src/db/create-database.js';
import { errorCode, errorMessage } from '../src/errors.js';

try {
  const { name, created } = await createDatabaseIfMissing(process.env.DATABASE_URL);
  console.log(created ? `Created database ${name}.` : `Database ${name} already exists.`);
} catch (error) {
  if (error instanceof CreateDatabaseError) {
    console.error(`Error: ${error.message}`);
  } else {
    // mysql2 messages name the host and port, never the password.
    const code = errorCode(error);
    console.error(`Error: create database failed: ${code ? `${code} ` : ''}${errorMessage(error)}`);
  }
  process.exitCode = 1;
}
