# prisma_io - Knowledge Ready

Arquivo preparado para uso em GPT, Claude Project, Codex ou base de conhecimento.

## Indice

1. [Docs Orm](#docs-orm)


---

## Docs Orm

Source URL: https://www.prisma.io/docs/orm

# Prisma ORM

Prisma ORM is a typed data layer for TypeScript, with typed queries and migrations for PostgreSQL, MongoDB, and SQLite.

Prisma ORM is the library your TypeScript app uses to read and write its database. You describe your data in a contract, which is the file that holds your models, and Prisma ORM gives you typed queries and migrations for it. If you know Prisma ORM 7, the contract takes the place of `schema.prisma`, and the queries have a new shape, which the example below shows.

Prisma ORM 8 is a release candidate, not yet a final release, and it is what `npm install prisma` gives you today. It supports PostgreSQL. MongoDB is in early access, so some of what works on PostgreSQL is missing on it. SQLite ships as an experimental package, `@prisma/orm-sqlite`. MySQL, SQL Server, and CockroachDB come later, and until then Prisma ORM 7 supports them. [Supported databases](https://www.prisma.io/docs/orm/supported-databases) says what early access and experimental mean, and what works on each database.

Here is a contract with two models, a query that reads them, and what the query prints against a database that holds two users and two posts. The first line of the contract, `// use prisma-8`, is required, and the setup commands write it for you. `db` is exported from `src/prisma/db.ts`, which reads `DATABASE_URL` and creates the client. For a new app, `npm create prisma@latest` writes both files. For an app you already have, `npx prisma@latest orm init` writes them. Run the query file with `npx tsx index.ts`, after a page under "Start here" has created the tables.

Every field in the result is typed from the contract, down to each post's `title`. `db.orm` holds the typed queries for your models, and `public` is the PostgreSQL schema the table is in, which is the default one unless you created another. After you change the contract, run `npx prisma contract emit`. It replaces `prisma generate`, and there is no `@prisma/client` package: your code imports `db` from `src/prisma/db.ts`.

[Start here](https://www.prisma.io#start-here)

Pick the page that matches where you are starting from. Each page uses PostgreSQL and links its MongoDB version.

### I'm creating a new app

Create an app from a template and run your first query.

### I have an app, but no database yet

Add Prisma ORM to your app, create the tables, and apply your first migration.

### I have a database already

Write the contract from the tables you have, then make your first change to the tables as a migration.

### I have a Prisma 7 app

Install Prisma ORM 8 next to Prisma ORM 7 in the same app, against the same database, and move one part of the app at a time.

Need a database? [ npx create-db](https://www.prisma.io/docs/postgres/npx-create-db) creates a temporary

[Prisma Postgres](https://www.prisma.io/docs/postgres)database in seconds, without signing up. To host the app, you can deploy it on

[Prisma Compute](https://www.prisma.io/docs/compute).

A `create-db` database is deleted after 24 hours unless you claim it, which needs a Prisma account. The Prisma CLI deploys apps to Prisma Compute with [Prisma Composer](https://www.prisma.io/docs/composer). Prisma Compute does not currently support WebSocket servers and has no multi-region deployments ([limitations](https://www.prisma.io/docs/compute/limitations)). Prisma Postgres has no point-in-time recovery yet; it is coming in November 2026 ([backups](https://www.prisma.io/docs/postgres/database/backups)).

[What you can do with Prisma ORM](https://www.prisma.io#what-you-can-do-with-prisma-orm)

- [Model your data](https://www.prisma.io/docs/orm/data-modeling): describe your models, their fields, and how they relate to each other.
- [Read and write data](https://www.prisma.io/docs/orm/fundamentals/reading-data): fetch, filter, sort, and paginate records, then create, update, and delete them.
- [Query relations](https://www.prisma.io/docs/orm/fundamentals/relations-and-joins): read related records in the same query with- `.include(...)`.
- [Run transactions](https://www.prisma.io/docs/orm/fundamentals/transactions): make several writes succeed or fail together.
- [Migrate your database](https://www.prisma.io/docs/orm/migrations/how-migrations-work): after you change the contract and run- `npx prisma contract emit`,- `npx prisma migration plan`writes the migration for you to review.- `npx prisma db migrate --advance-ref db`then applies it to your development database and records that it did, so the next plan starts from there. The two commands take the place of- `prisma migrate dev`.
- [Add middleware](https://www.prisma.io/docs/orm/middleware/how-middleware-works): run your own code before and after every query, for example to log each query. It takes the place of both- `$use`and- `$extends`.
- [Use extensions](https://www.prisma.io/docs/orm/extensions/using-extensions): add PostgreSQL features such as vector search, geospatial data, and full-text search. These are database extensions, not the- `$extends`of Prisma ORM 7.
- [Use the CLI](https://www.prisma.io/docs/cli): run the- `npx prisma`commands for your contract, your database, and your migrations.

[Coming from Prisma ORM 7](https://www.prisma.io#coming-from-prisma-orm-7)

[Coming from Prisma ORM 7](https://www.prisma.io/docs/orm/coming-from-prisma-orm-7) is a lookup table: what each Prisma ORM 7 schema attribute, command, and query is called in Prisma ORM 8. To move a running app, follow "I have a Prisma 7 app" above instead, and use the table while you do.

[Release status](https://www.prisma.io#release-status)

`npm install prisma` gives you Prisma ORM 8 today. If your app is on Prisma ORM 7 and you want to stay there, lock `prisma` and `@prisma/client` to version 7 in `package.json`, as [Release status](https://www.prisma.io/docs/orm/release-status) shows. That page also has the date of the final release and how long Prisma ORM 7 stays supported after it.
