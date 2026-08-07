import {providerErrors} from '../errors.ts'
import type {Hex, ProviderRequest} from '../../shared/types.ts'

export interface ProviderTransaction {
	from: Hex
	to?: Hex
	data?: Hex
	value?: Hex
	gas?: Hex
	gasPrice?: Hex
	nonce?: Hex

	[key: string]: unknown
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const DATA = /^0x(?:[0-9a-fA-F]{2})*$/
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/

export const readProviderTransaction = (
	params: ProviderRequest['params'],
): ProviderTransaction => {
	if (!Array.isArray(params) || params.length !== 1) {
		throw providerErrors.invalidParams('eth_sendTransaction requires one transaction object')
	}
	const value = params[0]
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw providerErrors.invalidParams('eth_sendTransaction requires one transaction object')
	}

	const transaction = value as Record<string, unknown>
	assertAddress(transaction.from, 'from', true)
	assertAddress(transaction.to, 'to', false)
	assertData(transaction.data)
	for (const field of ['value', 'gas', 'gasPrice', 'nonce'] as const) {
		assertQuantity(transaction[field], field)
	}
	return transaction as ProviderTransaction
}

export const readTransactionHash = (value: unknown): Hex => {
	const hash =
		typeof value === 'string'
			? value
			: value && typeof value === 'object' && !Array.isArray(value)
				? (value as { transactionHash?: unknown }).transactionHash
				: undefined
	if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
		throw new Error('RPC returned a malformed transaction hash')
	}
	return hash as Hex
}

const assertAddress = (
	value: unknown,
	field: 'from' | 'to',
	required: boolean,
): void => {
	if (value === undefined && !required) return
	if (typeof value !== 'string' || !ADDRESS.test(value)) {
		throw providerErrors.invalidParams(
			`eth_sendTransaction ${field} must be a 20-byte hexadecimal address`,
		)
	}
}

const assertData = (value: unknown): void => {
	if (value === undefined) return
	if (typeof value !== 'string' || !DATA.test(value)) {
		throw providerErrors.invalidParams(
			'eth_sendTransaction data must be even-length hexadecimal',
		)
	}
}

const assertQuantity = (value: unknown, field: string): void => {
	if (value === undefined) return
	if (typeof value !== 'string' || !QUANTITY.test(value)) {
		throw providerErrors.invalidParams(
			`eth_sendTransaction ${field} must be a canonical hexadecimal quantity`,
		)
	}
}
