declare module 'sm-crypto' {
	interface Sm2 {
		getPublicKeyFromPrivateKey(privateKey: string): string

		doSignature(
			message: string | number[],
			privateKey: string,
			options?: { hash?: boolean; der?: boolean; publicKey?: string; userId?: string },
		): string

		doVerifySignature(
			message: string | number[],
			signature: string,
			publicKey: string,
			options?: { hash?: boolean; der?: boolean; userId?: string },
		): boolean
	}

	interface SmCrypto {
		sm2: Sm2

		sm3(input: string | number[], options?: { key?: string | number[] }): string
	}

	const smCrypto: SmCrypto
	export default smCrypto
}
