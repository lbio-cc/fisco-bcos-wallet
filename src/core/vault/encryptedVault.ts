const encoder = new TextEncoder()
const decoder = new TextDecoder()

export interface VaultEnvelope {
	version: 1
	kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string }
	cipher: { name: 'AES-GCM'; iv: string }
	ciphertext: string
}

export interface OpenedVault<T> {
	value: T
	sessionKey: string

	reseal(value: T): Promise<VaultEnvelope>
}

const bytesToBase64 = (bytes: Uint8Array): string => {
	let binary = ''
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return btoa(binary)
}

const base64ToBytes = (value: string): Uint8Array => {
	const binary = atob(value)
	return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => Uint8Array.from(bytes).buffer

export class EncryptedVault {
	static readonly DEFAULT_ITERATIONS = 600_000

	async seal<T>(
		value: T,
		password: string,
		iterations = EncryptedVault.DEFAULT_ITERATIONS,
	): Promise<VaultEnvelope> {
		if (!password) throw new Error('Vault password must not be empty')
		const salt = crypto.getRandomValues(new Uint8Array(16))
		const key = await this.deriveKey(password, salt, iterations)
		return this.encrypt(value, key, {
			name: 'PBKDF2',
			hash: 'SHA-256',
			iterations,
			salt: bytesToBase64(salt),
		})
	}

	async open<T>(envelope: VaultEnvelope, password: string): Promise<T> {
		if (envelope.version !== 1) throw new Error(`Unsupported vault version: ${envelope.version}`)
		const key = await this.deriveKey(
			password,
			base64ToBytes(envelope.kdf.salt),
			envelope.kdf.iterations,
		)
		return this.decrypt<T>(envelope, key)
	}

	async openWithSession<T>(envelope: VaultEnvelope, password: string): Promise<OpenedVault<T>> {
		if (envelope.version !== 1) throw new Error(`Unsupported vault version: ${envelope.version}`)
		const key = await this.deriveKey(
			password,
			base64ToBytes(envelope.kdf.salt),
			envelope.kdf.iterations,
			true,
		)
		const sessionKey = bytesToBase64(new Uint8Array(await crypto.subtle.exportKey('raw', key)))
		return this.openWithKey(envelope, key, sessionKey)
	}

	async resumeWithSession<T>(
		envelope: VaultEnvelope,
		sessionKey: string,
	): Promise<OpenedVault<T>> {
		if (envelope.version !== 1) throw new Error(`Unsupported vault version: ${envelope.version}`)
		try {
			const key = await crypto.subtle.importKey(
				'raw',
				toArrayBuffer(base64ToBytes(sessionKey)),
				{name: 'AES-GCM'},
				false,
				['encrypt', 'decrypt'],
			)
			return await this.openWithKey(envelope, key, sessionKey)
		} catch {
			throw new Error('钱包会话已失效')
		}
	}

	private async openWithKey<T>(
		envelope: VaultEnvelope,
		key: CryptoKey,
		sessionKey: string,
	): Promise<OpenedVault<T>> {
		return {
			value: await this.decrypt<T>(envelope, key),
			sessionKey,
			reseal: (value: T) => this.encrypt(value, key, envelope.kdf),
		}
	}

	private async decrypt<T>(envelope: VaultEnvelope, key: CryptoKey): Promise<T> {
		try {
			const plaintext = await crypto.subtle.decrypt(
				{name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(envelope.cipher.iv))},
				key,
				toArrayBuffer(base64ToBytes(envelope.ciphertext)),
			)
			return JSON.parse(decoder.decode(plaintext)) as T
		} catch {
			throw new Error('钱包密码错误或加密数据已损坏')
		}
	}

	private async encrypt<T>(
		value: T,
		key: CryptoKey,
		kdf: VaultEnvelope['kdf'],
	): Promise<VaultEnvelope> {
		const iv = crypto.getRandomValues(new Uint8Array(12))
		const ciphertext = await crypto.subtle.encrypt(
			{name: 'AES-GCM', iv: toArrayBuffer(iv)},
			key,
			encoder.encode(JSON.stringify(value)),
		)
		return {
			version: 1,
			kdf,
			cipher: {name: 'AES-GCM', iv: bytesToBase64(iv)},
			ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
		}
	}

	private async deriveKey(
		password: string,
		salt: Uint8Array,
		iterations: number,
		extractable = false,
	): Promise<CryptoKey> {
		const material = await crypto.subtle.importKey(
			'raw',
			encoder.encode(password),
			'PBKDF2',
			false,
			['deriveKey'],
		)
		return crypto.subtle.deriveKey(
			{name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations},
			material,
			{name: 'AES-GCM', length: 256},
			extractable,
			['encrypt', 'decrypt'],
		)
	}
}
