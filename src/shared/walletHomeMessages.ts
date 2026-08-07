import type {CryptoKind, Hex, NetworkConfig} from './types'

export const TRANSACTION_ACTIVITIES_STORAGE_KEY = 'wallet:transactionActivities'

export interface AuthorizedSite {
	origin: string
	accounts: Hex[]
}

export interface TransactionActivity {
	id: string
	hash: Hex
	origin: string
	from: Hex
	to?: Hex
	networkId: string
	networkName: string
	groupId: string
	crypto: CryptoKind
	createdAt: string
	status: 'submitted' | 'success' | 'failed' | 'expired' | 'timeout'
	blockLimit?: string
	confirmedAt?: string
	receiptBlockNumber?: string
	receiptStatus?: string
	failureMessage?: string
}

export interface TransactionWatch {
	activityId: string
	hash: Hex
	network: NetworkConfig
	blockLimit?: string
	attempts: number
	maxAttempts: number
	expiresAt?: number
	nextCheckAt: number
	lastCheckedAt?: number
	lastError?: string
}

export interface WalletHomeSnapshot {
	currentOrigin?: string
	permissions: AuthorizedSite[]
	activities: TransactionActivity[]
}

export type WalletHomeRequest =
	| { type: 'WALLET_HOME_GET_SNAPSHOT' }
	| { type: 'WALLET_HOME_REVOKE_PERMISSION'; origin: string }

export interface WalletHomeResponse {
	result?: WalletHomeSnapshot
	error?: { code: number; message: string }
}

export const isWalletHomeRequest = (value: unknown): value is WalletHomeRequest => {
	if (!value || typeof value !== 'object' || !('type' in value)) return false
	const type = (value as { type?: unknown }).type
	return type === 'WALLET_HOME_GET_SNAPSHOT' || type === 'WALLET_HOME_REVOKE_PERMISSION'
}
