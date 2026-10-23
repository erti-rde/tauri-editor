/**
 * What the real app sends over the network during a journey (M6-4).
 *
 * Two records, because each misses what the other sees:
 *
 * - A logging proxy, handed to the app as `https_proxy`. Everything that
 *   honours it names the host it wants, and only the host: a TLS tunnel
 *   carries no path, and this proxy never looks inside one.
 * - `strace` on the driver, which follows it down to the app, the webview's
 *   network process and anything else they start. It logs every `connect`,
 *   so a connection that ignores the proxy, or a DNS lookup that would tell
 *   a resolver which host is wanted, still shows.
 *
 * `scripts/network-capture/summarise.mjs` reads both and checks them against
 * the README's list.
 */
import { createWriteStream } from 'node:fs';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';

/**
 * A forwarding proxy that writes one JSON line per request to `path`. It
 * passes traffic on rather than refusing it, so a journey behaves as it
 * would without the proxy.
 */
export function startProxy(path) {
	const log = createWriteStream(path, { flags: 'a' });
	const write = (entry) =>
		log.write(`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
	const record = (method, host, port) => write({ method, host, port });

	const server = createServer((req, res) => {
		// Plain HTTP: nothing in Erti should use it, but if something does, it's
		// recorded and goes through, the same as a tunnel.
		const url = new URL(req.url);
		record(req.method, url.hostname, Number(url.port || 80));
		const upstream = request(url, { method: req.method, headers: req.headers }, (response) => {
			res.writeHead(response.statusCode ?? 502, response.headers);
			response.pipe(res);
		});
		upstream.on('error', () => res.destroy());
		req.pipe(upstream);
	});

	server.on('connect', (req, client, head) => {
		const at = req.url.lastIndexOf(':');
		const host = req.url.slice(0, at).replace(/^\[|\]$/g, '');
		const port = Number(req.url.slice(at + 1));
		record('CONNECT', host, port);
		// How each tunnel ended goes in the log too, as a line of its own: a
		// journey that stalls on the network can then be told from one that
		// was refused.
		let failure;
		const upstream = connect(port, host, () => {
			client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
			upstream.write(head);
			upstream.pipe(client);
			client.pipe(upstream);
		});
		upstream.on('error', (error) => {
			failure ??= `upstream: ${error.code ?? error.message}`;
			client.destroy();
		});
		client.on('error', (error) => {
			failure ??= `client: ${error.code ?? error.message}`;
			upstream.destroy();
		});
		upstream.on('close', () =>
			write({
				closed: `${host}:${port}`,
				sent: upstream.bytesWritten,
				received: upstream.bytesRead,
				...(failure ? { failure } : {})
			})
		);
	});

	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () =>
			resolve({
				port: server.address().port,
				close: () =>
					new Promise((done) => {
						server.closeAllConnections?.();
						server.close(() => log.end(done));
					})
			})
		);
	});
}

/** Environment that points everything the app starts at the proxy. */
export function proxied(env, port) {
	const proxy = `http://127.0.0.1:${port}`;
	return {
		...env,
		http_proxy: proxy,
		https_proxy: proxy,
		HTTP_PROXY: proxy,
		HTTPS_PROXY: proxy,
		// The driver talks to WebKit's driver over loopback; that isn't traffic.
		no_proxy: 'localhost,127.0.0.1,::1',
		NO_PROXY: 'localhost,127.0.0.1,::1'
	};
}

/**
 * The command that runs `program` under `strace`, logging every `connect` of
 * it and its children to `path`. Only `connect` is traced: the webview's
 * processes talk to each other constantly over sockets they already hold,
 * and tracing those sends would slow the journey to a crawl.
 */
export function traced(program, path) {
	return ['strace', ['-f', '-qq', '--seccomp-bpf', '-e', 'trace=connect', '-o', path, program]];
}
