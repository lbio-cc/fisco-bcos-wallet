import {providerErrors} from '../errors.ts'

export interface FiscoTransactionNetworkMetadata {
	chainID: string
	groupID: string
	compatibilityVersion: number
	compatibilityVersionText: string
	smCryptoType: boolean
	isWasm: boolean
}

interface GroupNodeInfo {
	iniConfig?: unknown
	protocol?: {
		compatibilityVersion?: unknown
	}
}

export const readFiscoTransactionNetworkMetadata = (
	value: unknown,
): FiscoTransactionNetworkMetadata => {
	if (!isRecord(value)) throw malformedGroupInfo()

	const chainID = readNonEmptyString(value.chainID)
	const groupID = readNonEmptyString(value.groupID)
	const nodeList = value.nodeList
	if (!chainID || !groupID || !Array.isArray(nodeList) || nodeList.length === 0) {
		throw malformedGroupInfo()
	}

	const nodes = nodeList.map(readNodeInfo)
	const compatibilityVersions = nodes.map((node) =>
		readCompatibilityVersion(node.protocol?.compatibilityVersion),
	)
	const cryptoModes = nodes.map((node) => readNodeIniConfig(node.iniConfig))
	const smCryptoType = cryptoModes[0]!.smCryptoType
	const isWasm = cryptoModes[0]!.isWasm

	if (
		cryptoModes.some(
			(mode) => mode.smCryptoType !== smCryptoType || mode.isWasm !== isWasm,
		)
	) {
		throw providerErrors.disconnected(
			'FISCO group nodes disagree on crypto or virtual-machine mode',
		)
	}

	const compatibilityVersion = Math.min(...compatibilityVersions)
	return {
		chainID,
		groupID,
		compatibilityVersion,
		compatibilityVersionText: decodeFiscoCompatibilityVersion(compatibilityVersion),
		smCryptoType,
		isWasm,
	}
}

export const decodeFiscoCompatibilityVersion = (version: number): string => {
	if (!Number.isSafeInteger(version) || version < 0 || version > 0xffffffff) {
		throw new Error('Invalid FISCO compatibility version')
	}
	return [
		Math.floor(version / 0x1000000) & 0xff,
		Math.floor(version / 0x10000) & 0xff,
		Math.floor(version / 0x100) & 0xff,
	].join('.')
}

export const readFiscoBlockNumber = (value: unknown): bigint => {
	try {
		const parsed =
			typeof value === 'bigint'
				? value
				: typeof value === 'number' && Number.isSafeInteger(value)
					? BigInt(value)
					: typeof value === 'string' && /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)
						? BigInt(value)
						: -1n
		if (parsed < 0n || parsed > 0x7fffffffffffffffn) throw new Error()
		return parsed
	} catch {
		throw providerErrors.disconnected('RPC returned a malformed FISCO block number')
	}
}

const readNodeInfo = (value: unknown): GroupNodeInfo => {
	if (!isRecord(value)) throw malformedGroupInfo()
	return value
}

const readCompatibilityVersion = (value: unknown): number => {
	if (
		typeof value !== 'number' ||
		!Number.isSafeInteger(value) ||
		value < 0 ||
		value > 0xffffffff
	) {
		throw malformedGroupInfo()
	}
	return value
}

const readNodeIniConfig = (
	value: unknown,
): { smCryptoType: boolean; isWasm: boolean } => {
	if (typeof value !== 'string') throw malformedGroupInfo()
	try {
		const parsed = JSON.parse(value) as unknown
		if (
			!isRecord(parsed) ||
			typeof parsed.smCryptoType !== 'boolean' ||
			typeof parsed.isWasm !== 'boolean'
		) {
			throw new Error()
		}
		return {smCryptoType: parsed.smCryptoType, isWasm: parsed.isWasm}
	} catch {
		throw malformedGroupInfo()
	}
}

const readNonEmptyString = (value: unknown): string | undefined =>
	typeof value === 'string' && value.length > 0 ? value : undefined

const isRecord = (value: unknown): value is Record<string, any> =>
	!!value && typeof value === 'object' && !Array.isArray(value)

const malformedGroupInfo = () =>
	providerErrors.disconnected('RPC returned malformed FISCO group metadata')
