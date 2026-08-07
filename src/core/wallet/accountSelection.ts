import {providerErrors} from '../errors.ts'
import type {ProviderRequest} from '../../shared/types.ts'

export const readSwitchAccountAddress = (
	params: ProviderRequest['params'],
): `0x${string}` => {
	if (!Array.isArray(params) || params.length !== 1) {
		throw providerErrors.invalidParams('Expected [{ account: "0x..." }]')
	}
	const input = params[0]
	const account =
		input && typeof input === 'object' && 'account' in input
			? (input as {account?: unknown}).account
			: undefined
	if (
		typeof account !== 'string' ||
		!/^0x[0-9a-fA-F]{40}$/.test(account.trim())
	) {
		throw providerErrors.invalidParams('account must be a 20-byte hex address')
	}
	return account.trim() as `0x${string}`
}
