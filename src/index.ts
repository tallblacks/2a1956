interface Env {
  DB: D1Database;
}

interface Artifact {
  id: string;
  name: string | null;
  content: string;
  reference: string | null;
  created_at: string;
}

const PAGE_SIZE = 50;
const REFERENCE_PREVIEW_SIZE = 3;
const MAX_NAME_LENGTH = 256;
const MAX_CONTENT_LENGTH = 64 * 1024;

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (
      request.method === "GET" &&
      (url.pathname === "/" || url.pathname === "/read")
    ) {
      return readArtifacts(env, url);
    }

    if (request.method === "POST" && url.pathname === "/write") {
      return writeArtifact(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },
};

async function readArtifacts(
  env: Env,
  url: URL,
): Promise<Response> {
  const cursor = url.searchParams.get("cursor");

  let result;

  if (cursor) {
    result = await env.DB.prepare(
      `SELECT id, name, content, reference, created_at
       FROM artifacts
       WHERE created_at < ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
      .bind(cursor, PAGE_SIZE + 1)
      .all<Artifact>();
  } else {
    result = await env.DB.prepare(
      `SELECT id, name, content, reference, created_at
       FROM artifacts
       ORDER BY created_at DESC
       LIMIT ?`,
    )
      .bind(PAGE_SIZE + 1)
      .all<Artifact>();
  }

  const artifacts = result.results.slice(0, PAGE_SIZE);

  if (artifacts.length === 0) {
    return Response.json({
      artifacts: [],
      next_cursor: null,
    });
  }

  const ids = artifacts.map((artifact) => artifact.id);
  const placeholders = ids.map(() => "?").join(", ");

  const referencesResult = await env.DB.prepare(
    `SELECT id, name, content, reference, created_at
     FROM artifacts
     WHERE reference IN (${placeholders})
     ORDER BY created_at DESC`,
  )
    .bind(...ids)
    .all<Artifact>();

  const referencesByArtifact = new Map<string, Artifact[]>();

  for (const artifact of referencesResult.results) {
    if (!artifact.reference) {
      continue;
    }

    const list = referencesByArtifact.get(artifact.reference) ?? [];
    list.push(artifact);
    referencesByArtifact.set(artifact.reference, list);
  }

  const output = artifacts.map((artifact) => {
    const references = referencesByArtifact.get(artifact.id) ?? [];

    return {
      ...artifact,
      references: references.slice(0, REFERENCE_PREVIEW_SIZE),
      more: references.length > REFERENCE_PREVIEW_SIZE,
    };
  });

  const hasMore = result.results.length > PAGE_SIZE;

  const nextCursor =
    hasMore && artifacts.length > 0
      ? artifacts[artifacts.length - 1].created_at
      : null;

  return Response.json({
    artifacts: output,
    next_cursor: nextCursor,
  });
}

async function writeArtifact(
  request: Request,
  env: Env,
): Promise<Response> {
  let body: {
    name?: unknown;
    content?: unknown;
    reference?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const name =
    body.name === undefined || body.name === null
      ? null
      : String(body.name);

  const content =
    body.content === undefined || body.content === null
      ? ""
      : String(body.content);

  const reference =
    body.reference === undefined || body.reference === null
      ? null
      : String(body.reference);

  if (name !== null && name.length > MAX_NAME_LENGTH) {
    return Response.json(
      { error: "name is too long" },
      { status: 400 },
    );
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    return Response.json(
      { error: "content is too large" },
      { status: 400 },
    );
  }

  if (!content) {
    return Response.json(
      { error: "content is required" },
      { status: 400 },
    );
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO artifacts
      (id, name, content, reference, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, name, content, reference, createdAt)
    .run();

  return Response.json(
    {
      id,
      name,
      content,
      reference,
      created_at: createdAt,
    },
    { status: 201 },
  );
}