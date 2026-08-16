
//#region src/index.ts
const name = "headroom-stats-plugin";
const inject = ["webServer"];
function apply(ctx) {
	const fsRef = ctx.get("fs");
	const webServer = ctx.webServer;
	if (fsRef === undefined) return;
	const fs = fsRef;
	let envCache = null;
	/** A lone `%VAR%` (unset in cmd) is treated as null. */
	function cleanVar(v) {
		const s = String(v || "").trim();
		if (s.length === 0) return null;
		if (s.startsWith("%") && s.endsWith("%")) return null;
		return s;
	}
	async function captureStdout(sub, argv, cwd) {
		const handle = sub.spawn({
			argv,
			cwd,
			stdio: {
				stdin: "ignore",
				stdout: { maxBytes: 8192 },
				stderr: "ignore"
			},
			graceMs: 3e3
		});
		await handle.done;
		const read = handle.collected.stdout.readFrom(0);
		return read.text;
	}
	/** Probe the three env vars once via cmd (DSH host has no direct env access). */
	async function discoverEnv() {
		if (envCache !== null) return envCache;
		envCache = {
			savingsPath: null,
			workspaceDir: null,
			userProfile: null
		};
		const sub = ctx.get("subprocess");
		if (sub === undefined) return envCache;
		try {
			const exe = await sub.resolveExecutable("cmd.exe");
			const here = fs.processPath(await fs.resolve("."));
			const out = await captureStdout(sub, [
				exe,
				"/c",
				"echo %HEADROOM_SAVINGS_PATH%&echo %HEADROOM_WORKSPACE_DIR%&echo %USERPROFILE%"
			], here);
			const lines = out.split(/\r?\n/).map((s) => s.trim());
			envCache = {
				savingsPath: cleanVar(lines[0] ?? ""),
				workspaceDir: cleanVar(lines[1] ?? ""),
				userProfile: cleanVar(lines[2] ?? "")
			};
		} catch (e) {
			console.log("headroom env discovery failed", String(e?.message ?? e));
		}
		return envCache;
	}
	/** Resolve the savings file: HEADROOM_SAVINGS_PATH → workspace/proxy_savings.json → %USERPROFILE%/.headroom. */
	async function resolveSavingsTarget() {
		const env = await discoverEnv();
		const candidates = [];
		if (env.savingsPath) candidates.push(env.savingsPath);
		const base = env.workspaceDir || (env.userProfile ? `${env.userProfile}/.headroom` : null);
		if (base) candidates.push(`${base}/proxy_savings.json`);
		for (const p of candidates) try {
			const target = await fs.resolve(p);
			const info = await fs.stat(target);
			if (info !== undefined) return target;
		} catch {}
		return null;
	}
	function num(v) {
		return typeof v === "number" && Number.isFinite(v) ? v : 0;
	}
	function str(v) {
		return typeof v === "string" ? v : "";
	}
	function reshape(data) {
		const lt = data?.lifetime ?? {};
		const ss = data?.display_session ?? {};
		const rawProjects = data?.projects ?? {};
		const projects = Object.keys(rawProjects).map((n) => ({
			name: n,
			requests: num(rawProjects[n].requests),
			tokensSaved: num(rawProjects[n].tokens_saved),
			usd: num(rawProjects[n].compression_savings_usd)
		})).sort((a, b) => b.tokensSaved - a.tokensSaved).slice(0, 10);
		return {
			lifetime: {
				requests: num(lt.requests),
				tokensSaved: num(lt.tokens_saved),
				compressionUsd: num(lt.compression_savings_usd),
				cacheUsd: num(lt.cache_savings_usd),
				totalInputTokens: num(lt.total_input_tokens),
				totalInputCostUsd: num(lt.total_input_cost_usd)
			},
			session: {
				requests: num(ss.requests),
				tokensSaved: num(ss.tokens_saved),
				savingsPercent: num(ss.savings_percent),
				startedAt: str(ss.started_at),
				lastActivityAt: str(ss.last_activity_at)
			},
			projects,
			split: {
				compressionUsd: num(lt.compression_savings_usd),
				cacheUsd: num(lt.cache_savings_usd),
				cacheReadTokens: num(lt.cache_read_tokens)
			},
			meta: { schemaVersion: num(data?.schema_version) }
		};
	}
	async function getSnapshot() {
		const target = await resolveSavingsTarget();
		if (target === null) return {
			ok: false,
			error: "headroom savings file not found (checked HEADROOM_SAVINGS_PATH, workspace dir, ~/.headroom)"
		};
		try {
			const text = await fs.readText(target);
			const data = JSON.parse(text);
			return {
				ok: true,
				path: fs.processPath(target),
				...reshape(data)
			};
		} catch (e) {
			return {
				ok: false,
				error: "unreadable savings file: " + String(e?.message ?? e)
			};
		}
	}
	ctx.effect(() => webServer.register({
		kind: "exact",
		path: "/headroom-stats/api",
		handler: async (_req, res) => {
			try {
				const snapshot = await getSnapshot();
				const body = JSON.stringify(snapshot);
				res.writeHead(200, {
					"content-type": "application/json; charset=utf-8",
					"cache-control": "no-store"
				});
				res.end(body);
			} catch (e) {
				res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
				res.end(JSON.stringify({
					ok: false,
					error: String(e?.message ?? e)
				}));
			}
		}
	}));
}

//#endregion
export { apply, inject, name };