import type {CryptoKind, Hex} from './types'

export type ApprovalKind = 'connect' | 'transaction' | 'switch'

export interface ApprovalNetworkSnapshot {
	id: string
	name: string
	rpcUrl: string
	groupId?: string
	chainId: number
	metadataChainId?: string
	crypto: CryptoKind
}

export interface ConnectApprovalAccount {
	index: number
	name: string
	remark: string
	address: Hex
}

export interface ConnectApprovalData {
	kind: 'connect'
	origin: string
	network: ApprovalNetworkSnapshot
	accounts: ConnectApprovalAccount[]
}

export interface TransactionApprovalData {
	kind: 'transaction'
	origin: string
	network: ApprovalNetworkSnapshot
	account?: { index: number; name: string }
	from: Hex
	to?: Hex
	value: Hex
	data: Hex
	dataBytes: number
	selector?: Hex
}

export interface SwitchApprovalData {
	kind: 'switch'
	origin: string
	requestType: 'group' | 'chain'
	currentNetwork: ApprovalNetworkSnapshot
	network: ApprovalNetworkSnapshot
}

export type ApprovalData = ConnectApprovalData | TransactionApprovalData | SwitchApprovalData

export type ApprovalRuntimeRequest =
	| { type: 'APPROVAL_GET'; token: string; kind: ApprovalKind }
	| {
	type: 'APPROVAL_RESOLVE'
	token: string
	kind: ApprovalKind
	approved: boolean
	accountIndexes?: number[]
}
	| { type: 'APPROVAL_HEARTBEAT'; token: string; kind: ApprovalKind }

export interface ApprovalRuntimeResponse {
	result?: { data?: ApprovalData; accepted?: true }
	error?: { code: number; message: string }
}

export const isApprovalRuntimeRequest = (value: unknown): value is ApprovalRuntimeRequest => {
	if (!value || typeof value !== 'object') return false
	const message = value as Record<string, unknown>
	if (
		typeof message.token !== 'string' ||
		!message.token.trim() ||
		(message.kind !== 'connect' && message.kind !== 'transaction' && message.kind !== 'switch')
	) {
		return false
	}
	if (message.type === 'APPROVAL_GET' || message.type === 'APPROVAL_HEARTBEAT') return true
	if (message.type !== 'APPROVAL_RESOLVE' || typeof message.approved !== 'boolean') return false
	if (message.kind !== 'connect') return message.accountIndexes === undefined
	return (
		message.accountIndexes === undefined ||
		(Array.isArray(message.accountIndexes) &&
			message.accountIndexes.every((index) => Number.isInteger(index)))
	)
}
