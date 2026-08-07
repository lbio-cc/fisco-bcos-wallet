export interface HttpLimits {
	timeoutMs: number
	maxResponseBytes: number
	label: string
}

export const fetchWithTimeout = async (
	input: RequestInfo | URL,
	init: RequestInit,
	timeoutMs: number,
	label: string,
): Promise<Response> => {
	const controller = new AbortController()
	let timedOut = false
	const timer = globalThis.setTimeout(() => {
		timedOut = true
		controller.abort()
	}, timeoutMs)
	try {
		return await fetch(input, {...init, signal: controller.signal})
	} catch (error) {
		if (timedOut) throw new Error(`${label}请求超时（${timeoutMs}ms）`)
		throw error
	} finally {
		globalThis.clearTimeout(timer)
	}
}

export const readJsonResponse = async (
	response: Response,
	maxResponseBytes: number,
	label: string,
): Promise<unknown> => {
	const declaredLength = Number(response.headers.get('content-length'))
	if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
		throw new Error(`${label}响应超过 ${maxResponseBytes} 字节限制`)
	}
	if (!response.body) throw new Error(`${label}响应正文为空`)

	const reader = response.body.getReader()
	const chunks: Uint8Array[] = []
	let total = 0
	try {
		while (true) {
			const {done, value} = await reader.read()
			if (done) break
			total += value.byteLength
			if (total > maxResponseBytes) {
				await reader.cancel()
				throw new Error(`${label}响应超过 ${maxResponseBytes} 字节限制`)
			}
			chunks.push(value)
		}
	} finally {
		reader.releaseLock()
	}

	const bytes = new Uint8Array(total)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.byteLength
	}
	return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

export const fetchJsonWithLimits = async (
	input: RequestInfo | URL,
	init: RequestInit,
	limits: HttpLimits,
): Promise<{response: Response; value: unknown}> => {
	const response = await fetchWithTimeout(input, init, limits.timeoutMs, limits.label)
	if (!response.ok) return {response, value: undefined}
	return {
		response,
		value: await readJsonResponse(response, limits.maxResponseBytes, limits.label),
	}
}
