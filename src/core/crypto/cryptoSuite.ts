import type {CryptoKind, Hex} from '@/shared/types'

export interface Signature {
	bytes: Uint8Array
	recovery?: number
}

export interface CryptoSuite {
	readonly kind: CryptoKind

	hash(data: Uint8Array): Promise<Uint8Array>

	derivePublicKey(privateKey: Uint8Array): Promise<Uint8Array>

	deriveAddress(publicKey: Uint8Array): Promise<Hex>

	sign(digest: Uint8Array, privateKey: Uint8Array): Promise<Signature>

	verify(digest: Uint8Array, signature: Signature, publicKey: Uint8Array): Promise<boolean>
}

export class CryptoSuiteRegistry {
	private readonly suites = new Map<CryptoKind, CryptoSuite>()

	register(suite: CryptoSuite): void {
		this.suites.set(suite.kind, suite)
	}

	get(kind: CryptoKind): CryptoSuite {
		const suite = this.suites.get(kind)
		if (!suite) {
			throw new Error(
				`${kind} crypto driver is not installed. Refusing to sign with an incompatible algorithm.`,
			)
		}
		return suite
	}
}

