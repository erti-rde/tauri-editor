/**
 * What the real app sends over the network during a journey (M6-4).
 *
 * Two records, because each misses what the other sees:
 *
 * - A logging SOCKS proxy, handed to the app as `https_proxy`. Everything
 *   that honours it names the host it wants, and only the host: a TLS
 *   tunnel carries no path, and this proxy never looks inside one.
 * - `strace` on the driver, which follows it down to the app, the webview's
 *   network process and anything else they start. It logs every `connect`,
 *   so a connection that ignores the proxy, or a DNS lookup that would tell
 *   a resolver which host is wanted, still shows.
 *
 * `scripts/network-capture/summarise.mjs` reads both and checks them against
 * the README's list.
 */
import { createWriteStream } from 'node:fs';
import { connect, createServer } from 'node:net';

/**
 * A SOCKS5 proxy that writes one JSON line per connection to `path`, naming
 * the host and port asked for, and another when it closes. It passes
 * traffic on rather than refusing it, so a journey behaves as it would
 * without the proxy.
 *
 * SOCKS rather than an HTTP proxy: WebKitGTK handed an `http://` proxy opens
 * the CONNECT tunnel twice, once in GLib and again in libsoup, so the second
 * CONNECT arrives at the server as plain text and every request fails. GLib
 * does SOCKS on its own, and sends the host name rather than resolving it.
 */
export function startProxy(path) {
	const log = createWriteStream(path, { flags: 'a' });
	const write = (entry) =>
		log.write(`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
	const sockets = new Set();

	const server = createServer((client) => {
		sockets.add(client);
		client.on('close', () => sockets.delete(client));
		client.on('error', () => client.destroy());
		let buffer = Buffer.alloc(0);
		let greeted = false;

		const onData = (chunk) => {
			buffer = Buffer.concat([buffer, chunk]);
			if (!greeted) {
				// VER, NMETHODS, METHODS: answer "no authentication".
				if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return;
				if (buffer[0] !== 5) return client.destroy();
				buffer = buffer.subarray(2 + buffer[1]);
				greeted = true;
				client.write(Buffer.from([5, 0]));
			}
			const request = parseRequest(buffer);
			if (!request) return;
			client.off('data', onData);
			if (request.command !== 1) {
				// Only CONNECT: nothing in a webview binds or relays UDP.
				write({ method: `SOCKS ${request.command}`, host: request.host, port: request.port });
				return client.end(Buffer.from([5, 7, 0, 1, 0, 0, 0, 0, 0, 0]));
			}
			tunnel(client, request, buffer.subarray(request.length));
		};
		client.on('data', onData);
	});

	function tunnel(client, { host, port }, rest) {
		write({ method: 'CONNECT', host, port });
		// How it ended goes in the log too: a journey that stalls on the
		// network can then be told from one that was refused.
		let failure;
		const upstream = connect(port, host, () => {
			client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
			if (rest.length) upstream.write(rest);
			upstream.pipe(client);
			client.pipe(upstream);
		});
		sockets.add(upstream);
		upstream.on('error', (error) => {
			failure ??= `upstream: ${error.code ?? error.message}`;
			if (!client.destroyed) client.end(Buffer.from([5, 4, 0, 1, 0, 0, 0, 0, 0, 0]));
		});
		client.on('error', (error) => {
			failure ??= `client: ${error.code ?? error.message}`;
			upstream.destroy();
		});
		client.on('close', () => upstream.destroy());
		upstream.on('close', () => {
			sockets.delete(upstream);
			client.destroy();
			write({
				closed: `${host}:${port}`,
				sent: upstream.bytesWritten,
				received: upstream.bytesRead,
				...(failure ? { failure } : {})
			});
		});
	}

	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () =>
			resolve({
				port: server.address().port,
				close: () =>
					new Promise((done) => {
						for (const socket of sockets) socket.destroy();
						server.close(() => log.end(done));
					})
			})
		);
	});
}

/**
 * A SOCKS5 request (VER, CMD, RSV, ATYP, address, port), or null until all
 * of it has arrived.
 */
export function parseRequest(buffer) {
	if (buffer.length < 5) return null;
	const type = buffer[3];
	let host;
	let at;
	if (type === 1) {
		if (buffer.length < 10) return null;
		host = [...buffer.subarray(4, 8)].join('.');
		at = 8;
	} else if (type === 3) {
		at = 5 + buffer[4];
		if (buffer.length < at + 2) return null;
		host = buffer.subarray(5, at).toString('latin1');
	} else if (type === 4) {
		if (buffer.length < 22) return null;
		const words = [];
		for (let i = 4; i < 20; i += 2) words.push(buffer.readUInt16BE(i).toString(16));
		host = words.join(':');
		at = 20;
	} else {
		return null;
	}
	return { command: buffer[1], host, port: buffer.readUInt16BE(at), length: at + 2 };
}

/** Environment that points everything the app starts at the proxy. */
export function proxied(env, port) {
	const proxy = `socks5://127.0.0.1:${port}`;
	return {
		...env,
		http_proxy: proxy,
		https_proxy: proxy,
		all_proxy: proxy,
		HTTP_PROXY: proxy,
		HTTPS_PROXY: proxy,
		ALL_PROXY: proxy,
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
