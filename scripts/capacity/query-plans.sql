\set ON_ERROR_STOP on

\echo 'Run:' :run_id

\echo '=== search: title/alias ranking plus body tsquery ==='
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
WITH scope AS (
  SELECT work.user_id, work.id AS work_id, branch.id AS branch_id
  FROM works AS work
  INNER JOIN work_branches AS branch
    ON branch.work_id = work.id AND branch.user_id = work.user_id
  WHERE work.settings->>'benchmark' = 'true'
    AND branch.name = 'main'
  LIMIT 1
)
SELECT document.source_id,
       GREATEST(
         similarity(document.title, '山雨'),
         similarity(document.aliases::text, '山雨')
       )::float AS score
FROM search_documents AS document
INNER JOIN scope
  ON scope.user_id = document.user_id
 AND scope.work_id = document.work_id
 AND scope.branch_id = document.branch_id
WHERE (
  document.tsv @@ to_tsquery('simple', '山雨:*')
  OR lower(document.title) LIKE lower('%山雨%')
  OR lower(document.aliases::text) LIKE lower('%山雨%')
)
ORDER BY score DESC, document.updated_at DESC, document.source_id DESC
LIMIT 20;

\echo '=== chapter list and current version ==='
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
WITH scope AS (
  SELECT work.user_id, work.id AS work_id, branch.id AS branch_id
  FROM works AS work
  INNER JOIN work_branches AS branch
    ON branch.work_id = work.id AND branch.user_id = work.user_id
  WHERE work.settings->>'benchmark' = 'true'
    AND branch.name = 'main'
  LIMIT 1
)
SELECT chapter.*, version.content
FROM chapters AS chapter
INNER JOIN scope
  ON scope.user_id = chapter.user_id
 AND scope.work_id = chapter.work_id
 AND scope.branch_id = chapter.branch_id
LEFT JOIN chapter_versions AS version ON version.id = chapter.current_version_id
ORDER BY chapter.number
LIMIT 50;

\echo '=== branch version head read ==='
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
WITH scope AS (
  SELECT branch.id AS branch_id, branch.head_node_id
  FROM works AS work
  INNER JOIN work_branches AS branch
    ON branch.work_id = work.id AND branch.user_id = work.user_id
  WHERE work.settings->>'benchmark' = 'true'
  LIMIT 5
)
SELECT node.*
FROM scope
INNER JOIN version_nodes AS node ON node.id = scope.head_node_id
ORDER BY node.created_at DESC;

\echo '=== timeline read ==='
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
WITH scope AS (
  SELECT work.user_id, work.id AS work_id, branch.id AS branch_id
  FROM works AS work
  INNER JOIN work_branches AS branch
    ON branch.work_id = work.id AND branch.user_id = work.user_id
  WHERE work.settings->>'benchmark' = 'true'
    AND branch.name = 'main'
  LIMIT 1
)
SELECT event.*
FROM timeline_events AS event
INNER JOIN scope
  ON scope.user_id = event.user_id
 AND scope.work_id = event.work_id
 AND scope.branch_id = event.branch_id
ORDER BY event.story_time_sort_key
LIMIT 100;

\echo '=== database, table and index sizes ==='
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT pg_database_size(current_database()) AS database_bytes,
       COALESCE(sum(pg_table_size(c.oid)), 0) AS table_bytes,
       COALESCE(sum(pg_indexes_size(c.oid)), 0) AS index_bytes
FROM pg_class AS c
INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r';
