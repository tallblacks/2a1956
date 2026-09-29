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

const PAGE_SIZE = 2;
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

  // Read enough artifacts to determine the top-level page.
  // We fetch all artifacts for now because the first experiment
  // intentionally keeps the reference structure simple.
  const result = await env.DB.prepare(
    `SELECT id, name, content, reference, created_at
     FROM artifacts
     ORDER BY created_at DESC`,
  ).all<Artifact>();

  const allArtifacts = result.results;

  const artifactIds = new Set(
    allArtifacts.map((artifact) => artifact.id),
  );

  // An artifact is top-level when its reference is empty
  // or does not point to an existing artifact.
  const topLevel = allArtifacts.filter(
    (artifact) =>
      !artifact.reference ||
      !artifactIds.has(artifact.reference),
  );

  // Top-level pagination.
  let startIndex = 0;

  if (cursor) {
    const cursorIndex = topLevel.findIndex(
      (artifact) => artifact.created_at === cursor,
    );

    if (cursorIndex >= 0) {
      startIndex = cursorIndex + 1;
    }
  }

  const page = topLevel.slice(
    startIndex,
    startIndex + PAGE_SIZE,
  );

  const childrenByReference = new Map<string, Artifact[]>();

  for (const artifact of allArtifacts) {
    if (!artifact.reference || !artifactIds.has(artifact.reference)) {
      continue;
    }

    const children =
      childrenByReference.get(artifact.reference) ?? [];

    children.push(artifact);
    childrenByReference.set(artifact.reference, children);
  }

  for (const children of childrenByReference.values()) {
    children.sort(
      (a, b) =>
        b.created_at.localeCompare(a.created_at),
    );
  }

  function buildTree(artifact: Artifact): object {
    const children =
      childrenByReference.get(artifact.id) ?? [];

    return {
      ...artifact,
      references: children.map(buildTree),
    };
  }

  const artifacts = page.map(buildTree);

  const hasMore = startIndex + PAGE_SIZE < topLevel.length;

  const nextCursor =
    hasMore && page.length > 0
      ? page[page.length - 1].created_at
      : null;

  return Response.json({
    artifacts,
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