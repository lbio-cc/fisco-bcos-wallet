export const readNativeBalance = (value: unknown): string => {
	let candidate = value
	if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
		const record = candidate as Record<string, unknown>
		candidate = record.balance ?? record.value
	}
	if (
		typeof candidate !== 'string' &&
		typeof candidate !== 'number' &&
		typeof candidate !== 'bigint'
	) {
		throw new Error('节点返回了无效的余额')
	}
	try {
		const balance = BigInt(candidate)
		if (balance < 0n) throw new Error()
		return balance.toString(10)
	} catch {
		throw new Error('节点返回了无效的余额')
	}
}
