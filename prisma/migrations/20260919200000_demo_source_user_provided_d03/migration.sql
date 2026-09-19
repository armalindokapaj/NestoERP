-- D-03 §3: a demo tenant's fact may be supplied by the owner of its configuration
-- — neither public nor invented. Additive: no row changes.
ALTER TYPE "DemoSourceType" ADD VALUE 'USER_PROVIDED';
