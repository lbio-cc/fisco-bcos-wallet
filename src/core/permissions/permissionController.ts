import type {Hex} from '@/shared/types'

export interface PermissionStore {
	get(origin: string): Promise<readonly Hex[]>

	set(origin: string, accounts: readonly Hex[]): Promise<void>
}

export class PermissionController {
	constructor(private readonly store: PermissionStore) {
	}

	accountsFor(origin: string): Promise<readonly Hex[]> {
		return this.store.get(origin)
	}

	async grant(origin: string, accounts: readonly Hex[]): Promise<void> {
		const url = new URL(origin)
		const isLoopback =
			url.hostname === 'localhost' ||
			url.hostname === '127.0.0.1' ||
			url.hostname === '[::1]'
		if (url.protocol !== 'https:' && !isLoopback) {
			throw new Error('Account access may only be granted to HTTPS origins or localhost')
		}
		await this.store.set(url.origin, [...new Set(accounts)])
	}

	revoke(origin: string): Promise<void> {
		return this.store.set(new URL(origin).origin, [])
	}
}
