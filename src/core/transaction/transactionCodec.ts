import type {CryptoSuite} from '../crypto/cryptoSuite'
import type {Hex, NetworkConfig} from '@/shared/types'

export interface TransactionIntent {
	from: Hex
	to?: Hex
	data?: Hex
	value?: Hex
	gas?: Hex
	extraData?: Record<string, unknown>
}

export interface TransactionCodec {
	readonly cryptoKind: CryptoSuite['kind']

	encodeAndSign(
		intent: TransactionIntent,
		network: NetworkConfig,
		privateKey: Uint8Array,
		crypto: CryptoSuite,
	): Promise<Hex>
}

