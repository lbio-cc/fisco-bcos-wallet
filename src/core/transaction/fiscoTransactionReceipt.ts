export interface ParsedFiscoTransactionReceipt {
	status: string
	successful: boolean
	blockNumber?: string
}

export type FiscoReceiptParseResult =
	| { kind: 'pending' }
	| { kind: 'malformed'; error: string }
	| { kind: 'receipt'; receipt: ParsedFiscoTransactionReceipt }

const readUnsignedInteger = (value: unknown): bigint | undefined => {
	if (typeof value === 'bigint') return value >= 0n ? value : undefined
	if (typeof value === 'number') {
		return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : undefined
	}
	if (typeof value !== 'string' || value.length === 0) return undefined
	if (!/^(?:0|[1-9][0-9]*|0x[0-9a-fA-F]+)$/.test(value)) return undefined
	try {
		const parsed = BigInt(value)
		return parsed >= 0n ? parsed : undefined
	} catch {
		return undefined
	}
}

export const parseFiscoTransactionReceipt = (
	value: unknown,
	expectedHash: string,
): FiscoReceiptParseResult => {
	if (value === null || value === undefined) return {kind: 'pending'}
	if (typeof value !== 'object' || Array.isArray(value)) {
		return {kind: 'malformed', error: '交易回执格式无效'}
	}

	const candidate = value as Record<string, unknown>
	if (
		candidate.transactionHash !== undefined &&
		(typeof candidate.transactionHash !== 'string' ||
			candidate.transactionHash.toLowerCase() !== expectedHash.toLowerCase())
	) {
		return {kind: 'malformed', error: '交易回执哈希不匹配'}
	}
	const status = readUnsignedInteger(candidate.status)
	if (status === undefined) return {kind: 'malformed', error: '交易回执状态无效'}
	const blockNumber =
		candidate.blockNumber === undefined ? undefined : readUnsignedInteger(candidate.blockNumber)
	if (candidate.blockNumber !== undefined && blockNumber === undefined) {
		return {kind: 'malformed', error: '交易回执块高无效'}
	}
	return {
		kind: 'receipt',
		receipt: {
			status: status.toString(10),
			successful: status === 0n,
			...(blockNumber === undefined ? {} : {blockNumber: blockNumber.toString(10)}),
		},
	}
}
