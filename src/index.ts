/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
	async fetch(request, env, ctx): Promise<Response> {
		if (request.method === "GET") {
			const result = await env.DB
				.prepare(
					"SELECT id, content, created_at FROM artifacts ORDER BY id DESC"
				)
				.all();

			return Response.json(result.results);
		}

		if (request.method === "POST") {
			await env.DB
				.prepare("INSERT INTO artifacts (content) VALUES (?)")
				.bind(await request.text())
				.run();

			return new Response("written", { status: 201 });
		}

    	return new Response("method not supported", { status: 405 });
	},
} satisfies ExportedHandler<Env>;
