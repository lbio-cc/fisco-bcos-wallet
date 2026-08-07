import {providerErrors} from '../errors.ts'
import type {NetworkConfig, ProviderRequest} from '../../shared/types.ts'

export const readSwitchGroupId = (params: ProviderRequest['params']): string => {
	if (!Array.isArray(params) || params.length !== 1) {
		throw providerErrors.invalidParams('Expected [{ groupId: "group0" }]')
	}
	const input = params[0]
	const groupId =
		input && typeof input === 'object' && 'groupId' in input
			? (input as { groupId?: unknown }).groupId
			: undefined
	if (typeof groupId !== 'string' || !groupId.trim()) {
		throw providerErrors.invalidParams('groupId must be a non-empty string')
	}
	return groupId.trim()
}

export const selectGroupNetwork = (
	networks: readonly NetworkConfig[],
	active: NetworkConfig | undefined,
	groupId: string,
): NetworkConfig => {
	const candidates = networks.filter((candidate) => candidate.groupId === groupId)
	if (!candidates.length) throw providerErrors.groupNotFound(groupId)

	const sameEndpoint = active
		? candidates.filter(
			(candidate) => normalizeEndpoint(candidate.rpcUrl) === normalizeEndpoint(active.rpcUrl),
		)
		: []
	const network =
		sameEndpoint.length === 1
			? sameEndpoint[0]
			: candidates.length === 1
				? candidates[0]
				: undefined
	if (!network) {
		throw providerErrors.invalidParams(
			`Group ID is ambiguous across configured RPC endpoints: ${groupId}`,
		)
	}
	return network
}

const normalizeEndpoint = (rpcUrl: string): string => {
	const url = new URL(rpcUrl)
	url.hash = ''
	if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '')
	return url.toString()
}
