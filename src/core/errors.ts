export class ProviderError extends Error {
	constructor(
		public readonly code: number,
		message: string,
		public readonly data?: unknown,
	) {
		super(message)
		this.name = 'ProviderError'
	}
}

export const providerErrors = {
	unauthorized: () => new ProviderError(4100, 'The requested account or method is not authorized'),
	unsupported: (method: string) => new ProviderError(4200, `Unsupported method: ${method}`),
	disconnected: (reason: string) => new ProviderError(4900, reason),
	groupNotFound: (groupId: string) =>
		new ProviderError(4902, `Unrecognized group ID: ${groupId}`),
	chainNotFound: (chainId: string) =>
		new ProviderError(4902, `Unrecognized chain ID: ${chainId}`),
	userRejected: () => new ProviderError(4001, 'User rejected the request'),
	invalidParams: (reason: string) => new ProviderError(-32602, reason),
}
