\set ON_ERROR_STOP on

-- Required psql variables are supplied from Secret refs declared in deployment-bindings.json.
\if :{?ui4a_migration_password}
\else
  \echo 'missing required Secret variable: ui4a_migration_password'
  \quit 3
\endif
\if :{?ui4a_runtime_password}
\else
  \echo 'missing required Secret variable: ui4a_runtime_password'
  \quit 3
\endif
\if :{?keycloak_runtime_password}
\else
  \echo 'missing required Secret variable: keycloak_runtime_password'
  \quit 3
\endif
\if :{?temporal_schema_password}
\else
  \echo 'missing required Secret variable: temporal_schema_password'
  \quit 3
\endif
\if :{?temporal_runtime_password}
\else
  \echo 'missing required Secret variable: temporal_runtime_password'
  \quit 3
\endif
\if :{?postgres_backup_password}
\else
  \echo 'missing required Secret variable: postgres_backup_password'
  \quit 3
\endif

SELECT 'CREATE ROLE ui4a_migration LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ui4a_migration') \gexec
ALTER ROLE ui4a_migration LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD :'ui4a_migration_password';

SELECT 'CREATE ROLE ui4a_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ui4a_runtime') \gexec
ALTER ROLE ui4a_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD :'ui4a_runtime_password';

SELECT 'CREATE ROLE keycloak_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'keycloak_runtime') \gexec
ALTER ROLE keycloak_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD :'keycloak_runtime_password';

SELECT 'CREATE ROLE temporal_schema LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'temporal_schema') \gexec
ALTER ROLE temporal_schema LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD :'temporal_schema_password';

SELECT 'CREATE ROLE temporal_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'temporal_runtime') \gexec
ALTER ROLE temporal_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD :'temporal_runtime_password';

SELECT 'CREATE ROLE postgres_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres_backup') \gexec
ALTER ROLE postgres_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD :'postgres_backup_password';

SELECT 'CREATE DATABASE ui4a OWNER ui4a_migration'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ui4a') \gexec
ALTER DATABASE ui4a OWNER TO ui4a_migration;

SELECT 'CREATE DATABASE keycloak OWNER keycloak_runtime'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'keycloak') \gexec
ALTER DATABASE keycloak OWNER TO keycloak_runtime;

SELECT 'CREATE DATABASE temporal OWNER temporal_schema'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'temporal') \gexec
ALTER DATABASE temporal OWNER TO temporal_schema;

SELECT 'CREATE DATABASE temporal_visibility OWNER temporal_schema'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'temporal_visibility') \gexec
ALTER DATABASE temporal_visibility OWNER TO temporal_schema;

GRANT CONNECT ON DATABASE ui4a TO ui4a_runtime;
GRANT CONNECT ON DATABASE keycloak TO keycloak_runtime;
GRANT CONNECT ON DATABASE temporal, temporal_visibility TO temporal_runtime;
GRANT CONNECT ON DATABASE ui4a, keycloak, temporal, temporal_visibility TO postgres_backup;

\connect ui4a
GRANT USAGE ON SCHEMA public TO ui4a_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ui4a_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ui4a_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE ui4a_migration IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ui4a_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE ui4a_migration IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ui4a_runtime;
GRANT USAGE ON SCHEMA public TO postgres_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO postgres_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO postgres_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE ui4a_migration IN SCHEMA public
  GRANT SELECT ON TABLES TO postgres_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE ui4a_migration IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO postgres_backup;

\connect keycloak
GRANT USAGE ON SCHEMA public TO postgres_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO postgres_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO postgres_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE keycloak_runtime IN SCHEMA public
  GRANT SELECT ON TABLES TO postgres_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE keycloak_runtime IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO postgres_backup;

\connect temporal
GRANT USAGE ON SCHEMA public TO temporal_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO temporal_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO temporal_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE temporal_schema IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO temporal_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE temporal_schema IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO temporal_runtime;
GRANT USAGE ON SCHEMA public TO postgres_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO postgres_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO postgres_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE temporal_schema IN SCHEMA public
  GRANT SELECT ON TABLES TO postgres_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE temporal_schema IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO postgres_backup;

\connect temporal_visibility
GRANT USAGE ON SCHEMA public TO temporal_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO temporal_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO temporal_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE temporal_schema IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO temporal_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE temporal_schema IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO temporal_runtime;
GRANT USAGE ON SCHEMA public TO postgres_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO postgres_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO postgres_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE temporal_schema IN SCHEMA public
  GRANT SELECT ON TABLES TO postgres_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE temporal_schema IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO postgres_backup;
